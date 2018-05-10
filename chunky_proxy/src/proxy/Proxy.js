const mc = require('minecraft-protocol')

const replayPackets = require('./Proxy/packetReplayer')
const addListeners = require('./Proxy/addListeners')

class Proxy extends mc.Server {
  /**
   * Create a minecraft proxy
   * @param {Object} serverSettings Settings for the minecraft-protocol server
   * @param {Object} serverList An object that maps a 'serverName' to the server info
   * @param {Object} proxyOptions Proxy settings
   */
  constructor (serverSettings = {}, serverList = {}, proxyOptions = {}) {
    super(serverSettings.version, serverSettings.customPackets)
    this.serverList = serverList

    this.autoConnect = (typeof proxyOptions.autoConnect === 'undefined') ? true : !!proxyOptions.autoConnect
    this.autoFallback = (typeof proxyOptions.autoFallback === 'undefined') ? true : !!proxyOptions.autoFallback

    let self = this
    self.on('login', (remoteClient) => {
      let id = remoteClient.id

      remoteClient.on('end', () => {
        if (remoteClient.localClient) remoteClient.localClient.end()
      })

      remoteClient.on('error', () => {
        if (remoteClient.localClient) remoteClient.localClient.end()
      })

      this.clients[id].isFirstConnection = true
      this.clients[id].currentServer = ''

      if (this.autoConnect) {
        let defaultServer = this.getDefaultServerName()
        this.setRemoteServer(id, defaultServer)
      }
    })
  }

  /**
   * Moves the specified client to the specified server
   * @param {number} remoteClientId The ID of the player to move
   * @param {string} newServerName The name of the server where the player should be moved
   */
  setRemoteServer (remoteClientId, newServerName) {
    console.log("Init swap remoteID", remoteClientId, "server name", newServerName);

    let remoteClient = this.clients[remoteClientId];

    let oldServerName = remoteClient.currentServer;
    let newServer = this.serverList[newServerName];

    console.log("remote client server", remoteClient.currentServer);

    console.log("left", remoteClient.currentServer, "right", newServerName, "equal", remoteClient.currentServer === newServerName);

    if (remoteClient.currentServer === newServerName) return;

    this.emit('playerMoving', remoteClientId, oldServerName, newServerName);
    console.log("Moving player.");

    this.clients[remoteClientId].currentServer = newServerName;

    let newLocalClient = mc.createClient({
      host: newServer.host,
      port: newServer.port,
      username: remoteClient.username,
      keepAlive: false, // keep alive is set to false because the remote server will send the packets and the remote client will respond
      version: remoteClient.version
    });

    newLocalClient.on('error', (err) => {
      this.emit('playerMoveFailed', err, remoteClientId, oldServerName, newServerName)
      this.emit('error', err)
      console.error("Move Error:", err);
      // this.fallback(remoteClientId)
    });

    console.log("New client now!");

    if (!remoteClient.isFirstConnection) {
      replayPackets(remoteClient, newLocalClient, () => {
        remoteClient.localClient.end()
        remoteClient.localClient = newLocalClient
        newLocalClient = undefined
        addListeners(remoteClient, this)
      })
    } else {
      remoteClient.localClient = newLocalClient
      newLocalClient = undefined
      addListeners(remoteClient, this)
      remoteClient.isFirstConnection = false
    }

    this.emit('playerMoved', remoteClientId, oldServerName, newServerName)
    console.log("Player moved");
  }

  /**
   * Moves the specified client to the fallback server
   * @param {number} remoteClientId The ID of the player to move
   */
  fallback (remoteClientId) {
    return;
    let oldServerName = this.clients[remoteClientId].currentServer
    let fallbackServerName = this.getFallbackServerName()
    this.emit('playerFallback', remoteClientId, oldServerName, fallbackServerName)
    if (this.autoFallback) this.setRemoteServer(remoteClientId, fallbackServerName)
  }

  /**
   * Returns the fallback server's name
   * @returns {string} The fallback server's name
   */
  getFallbackServerName () {
    for (let serverName in this.serverList) {
      if (this.serverList[serverName].isFallback) return serverName
    }

    this.emit('error', new Error('No fallback server found!'))
  }

  /**
   * Returns the default server's name
   * @returns {string} The default server's name
   */
  getDefaultServerName () {
    for (let serverName in this.serverList) {
      if (this.serverList[serverName].isDefault) return serverName
    }

    this.emit('error', new Error('No default server found!'))
  }
}

module.exports = Proxy
