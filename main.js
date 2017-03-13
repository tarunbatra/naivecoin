'use strict';
var CryptoJS = require("crypto-js");
var express = require("express");
var bodyParser = require('body-parser');
var WebSocket = require("ws");

var http_port = process.env.HTTP_PORT || 3001;
var p2p_port = process.env.P2P_PORT || 6001;
var initialPeers = process.env.PEERS ? process.env.PEERS.split(',') : [];
var difficulty = process.env.DIFFICULTY || 2;
var requiredTxnsPerBlock = process.env.TXNS_PER_BLOCK || 4;
var coinbaseReward = Number(process.env.COINBASE_REWARD) || 50;
var isMiner = Boolean(process.env.MINER);
class Block {
  constructor(index, previousHash, timestamp, data, hash, nonce) {
    this.index = index;
    this.previousHash = previousHash.toString();
    this.timestamp = timestamp;
    this.data = data;
    this.hash = hash.toString();
    this.nonce = nonce;
  }
}

class Transaction {
  constructor(from, to, value, timestamp, hash) {
    this.from = from;
    this.to = to;
    this.value = Number(value);
    this.timestamp = timestamp;
    this.hash = hash;
  }

  static Apply(txn) {
    Transaction.applied.push(txn.hash);
  }

  static isApplied(txn) {
    return Transaction.applied.indexOf(txn.hash) > -1;
  }
}

Transaction.list = {};
Transaction.applied = [];
Transaction.pending = [];

class Account {

  constructor(address, balance) {
    this.address = address || Account.generateAddress();
    this.balance = Number(balance || 0);
    Account.list[this.address] = this;
  }

  getBalance() {
    return this.balance;
  }

  incBalance(amount) {
    this.balance += Number(amount);
  }

  decBalance(amount) {
    this.balance -= Number(amount);
  }

  static generateAddress() {
    return CryptoJS.SHA256(String(process.pid) + Date.now()).toString();
  }

  static has(address) {
    return Boolean(Account.list[address]);
  }

  static get(address) {
    return Account.list[address];
  }
}

Account.list = {};

var blockchain = [];
var sockets = [];
var MessageType = {
  QUERY_LATEST: 0,
  QUERY_ALL: 1,
  RESPONSE_BLOCKCHAIN: 2,
  NEW_TXNS: 3,
  QUERY_TXN: 4,
  QUERY_ALL_TXNS: 5,
  RESPONSE_TXNS: 6
};

var generateGenesisBlock = () => {
  var txnData = {
    from: null,
    to: 'e23090a61fabced0972658ae07493e3e3e12568a3dd9e99d9da471e7bdcf90da',
    value: 50,
    timestamp: 1465154705
  };
  txnData.hash = calculateHashForTxn(txnData);
  var genesisTransaction = new Transaction(txnData.from, txnData.to, txnData.value, txnData.timestamp, txnData.hash);
  Transaction.list[genesisTransaction.hash] = genesisTransaction;
  Transaction.Apply(genesisTransaction);
  updateAccount(genesisTransaction);
  var blockData = {
    index: 0,
    previousHash: '0000000000000000000000000000000000000000000000000000000000000000',
    timestamp: 1465154705,
    data: {
      txns: [ genesisTransaction.hash ]
    },
    nonce: 0
  };
  blockData.hash = calculateHashForBlock(blockData);

  var genesisBlock = new Block(blockData.index, blockData.previousHash, blockData.timestamp, blockData.data, blockData.hash, blockData.nonce);
  blockchain = [ genesisBlock ];
};

var getGenesisBlock = () => {
  return blockchain[0];
};

var mineBlock = (block) => {
  var newBlock = generateNextBlock(block);
  addBlock(newBlock);
  broadcast(responseLatestMsg());
  console.log('block added: ' + JSON.stringify(newBlock));
};

var generateBlockData = () => {
  return { txns: Transaction.pending };
};

var saveTransaction = (txn) => {
  Transaction.list[txn.hash] = txn;
};

var stageTransaction = (txn) => {
  Transaction.pending.push(txn.hash);
};

var readyToMineBlock = () => {
  return Transaction.pending.length >= requiredTxnsPerBlock;
};

var broadcastTxn = (txnHash) => {
  var txns = {};
  if (typeof txnHash === 'string') {
    txns[txnHash] = Transaction.list[txnHash];
  } else {
    txns[txnHash.hash] = txnHash;
  }
  broadcast({ 'type': MessageType.NEW_TXNS, 'data': JSON.stringify(txns)});
};

var generateCoinbaseTxn = () => {
  var txnData = {
    from: null,
    to: myAccount.address,
    value: coinbaseReward,
    timestamp: Date.now()
  };
  txnData.hash = calculateHashForTxn(txnData);
  var coinbaseTxn = new Transaction(txnData.from, txnData.to, txnData.value, txnData.timestamp, txnData.hash);
  Transaction.list[coinbaseTxn.hash] = coinbaseTxn;
  updateAccount(coinbaseTxn);
  Transaction.Apply(coinbaseTxn);
  return coinbaseTxn;
};

var generateBlockData = () => {
  var stagedTransactions = Transaction.pending.slice(0, requiredTxnsPerBlock);
  Transaction.pending = Transaction.pending.slice(requiredTxnsPerBlock);
  stagedTransactions.push(generateCoinbaseTxn().hash);
  return { txns: stagedTransactions };
};

var calculateHashForTxn = (txn) => {
  return calculateHash(txn.from, txn.to, txn.value, txn.timestamp, '');
};

var unstageTransaction = (txnHash) => {
  var index = Transaction.pending.indexOf(txnHash);
  if (index > -1) {
    Transaction.pending.splice(index);
  }
  console.log('transaction already mined. unstaging: ' + txnHash);
};

var addTransaction = (txn, alreadyMined) => {
  txn.timestamp = txn.timestamp || Date.now();
  txn.hash = calculateHashForTxn(txn);
  var transaction = new Transaction(txn.from, txn.to, txn.value, txn.timestamp, txn.hash);
  if (!Transaction.list[transaction.hash]) {
    if (!alreadyMined) {
      if(isTransferValid(txn)) {
        if (isMiner) {
          saveTransaction(transaction);
          console.log('transaction added: ' + JSON.stringify(transaction));
          stageTransaction(transaction);

          if (!Transaction.isApplied(txn)) {
            updateAccount(txn);
            Transaction.Apply(txn);
          }
          if (readyToMineBlock()) {
            console.log('enough transactions received');
            mineBlock(generateBlockData());
          } else {
            console.log(requiredTxnsPerBlock - Transaction.pending.length + ' more transactions required for mining');
          }
        } else {
          broadcastTxn(transaction);
          }
      } else {
        console.log('Transaction discarded: Not valid');
      }
    } else {
      saveTransaction(transaction);

      if (!Transaction.isApplied(txn)) {
        updateAccount(txn);
        Transaction.Apply(txn);
      }
      broadcastTxn(transaction.hash);
      console.log('transaction added: ' + JSON.stringify(transaction));
    }
  } else {
    console.log('duplicate transaction');
    if (alreadyMined) {
      unstageTransaction(txn.hash);
    }
  }
};


var calculateHashForBlock = (block) => {
  return calculateHash(block.index, block.previousHash, block.timestamp, block.data, block.nonce);
};

var calculateHash = (index, previousHash, timestamp, data, nonce) => {
  return CryptoJS.SHA256(index + previousHash + timestamp + data + nonce).toString();
};

var isTransferValid = (txn) => {
  var sender = Account.get(txn.from);
  return sender && sender.balance >= txn.value;
};

var updateAccount = (txn) => {
  var sender = Account.get(txn.from);
  var receiver = Account.get(txn.to) || new Account(txn.to);
  if (sender) {
    if (isTransferValid(txn)) {
      sender.decBalance(txn.value);
      receiver.incBalance(txn.value);
    } else {
      console.error('Sender doesn\'t have enough CbCoins');
    }
  } else {
    receiver.incBalance(txn.value);
  }
};
var myAccount = new Account(process.env.ADDRESS, process.env.BALANCE);
generateGenesisBlock();

var initHttpServer = () => {
  var app = express();
  app.use(bodyParser.json());

  app.get('/blocks', (req, res) => res.send(JSON.stringify(blockchain)));
  app.get('/block/:id', (req, res) => res.send(JSON.stringify(blockchain.find((block) => block.hash === req.params.id))));
  app.get('/transactions', (req, res) => res.send(JSON.stringify(Transaction.list)));
  app.get('/transaction/:id', (req, res) => res.send(JSON.stringify(Transaction.list[req.params.id])));
  app.get('/accounts', (req, res) => res.send(Account.list));
  app.get('/account/:id', (req, res) => res.send(Account.get(req.params.id)));
  app.get('/my-account', (req, res) => res.send(myAccount));
  app.post('/transact', (req, res) => {
    var txnData = req.body.data;
    addTransaction(txnData);
    res.send();
  });
  app.get('/peers', (req, res) => {
    res.send(sockets.map(s => s._socket.remoteAddress + ':' + s._socket.remotePort));
  });
  app.post('/addPeer', (req, res) => {
    connectToPeers([req.body.peer]);
    res.send();
  });

  app.post('/turnMalicious', (req, res) => {
    console.log('node turning malicious...');
    var targetedBlock = blockchain[req.body.index];
    targetedBlock.data = req.body.data;
    blockchain[targetedBlock.index].data = targetedBlock.data;
    var prevBlock = blockchain[targetedBlock.index -1];

    for (var i = targetedBlock.index; i < blockchain.length; i++) {
      var block = blockchain[i];
      var pow = generatePoW(block.index, prevBlock.hash, block.timestamp, block.data);
      block = new Block(block.index, prevBlock.hash, block.timestamp, block.data, pow.hash, pow.nonce);
      blockchain[i] = block;
      prevBlock = block;
    }
    console.log('local blockchain corrupted...');
    broadcast({ 'type': MessageType.RESPONSE_BLOCKCHAIN, 'data': JSON.stringify(blockchain) });
    console.log('corrrupted blockchain broadcasted');
    res.send();
  });
  app.listen(http_port, () => console.log('Listening http on port: ' + http_port));
};


var initP2PServer = () => {
  var server = new WebSocket.Server({port: p2p_port});
  server.on('connection', ws => initConnection(ws));
  console.log('listening websocket p2p port on: ' + p2p_port);

};

var initConnection = (ws) => {
  sockets.push(ws);
  initMessageHandler(ws);
  initErrorHandler(ws);
  write(ws, queryChainLengthMsg());
};

var initMessageHandler = (ws) => {
  ws.on('message', (data) => {
    var message = JSON.parse(data);
    console.log('Received message' + JSON.stringify(message));
    switch (message.type) {
      case MessageType.QUERY_LATEST:
      write(ws, responseLatestMsg());
      break;
      case MessageType.QUERY_ALL:
      write(ws, responseChainMsg());
      break;
      case MessageType.RESPONSE_BLOCKCHAIN:
      handleBlockchainResponse(message);
      break;
      case MessageType.NEW_TXNS:
      handleNewTxns(message);
      break;
      case MessageType.QUERY_TXN:
      handleTxnsQuery(ws, message);
      break;
      case MessageType.QUERY_ALL_TXNS:
      handleTxnsQuery(ws);
      break;
      case MessageType.RESPONSE_TXNS:
      handleNewTxns(message, true);
      break;
    }
  });
};

var initErrorHandler = (ws) => {
  var closeConnection = (ws) => {
    console.log('connection failed to peer: ' + ws.url);
    sockets.splice(sockets.indexOf(ws), 1);
  };
  ws.on('close', () => closeConnection(ws));
  ws.on('error', () => closeConnection(ws));
};

var isValidPoW = (pow) => {
  return (new RegExp('^[0]{' + difficulty + '}')).test(pow);
};

var generatePoW = (index, previousHash, nextTimestamp, blockData) => {
  var hash;
  var nonce = -1;
  do {
    hash = calculateHash(index, previousHash, nextTimestamp, blockData, ++nonce);
  }
  while (!isValidPoW(hash));

  return {
    hash: hash,
    nonce: nonce
  };
};

var generateNextBlock = (blockData) => {
  var previousBlock = getLatestBlock();
  var nextIndex = previousBlock.index + 1;
  var nextTimestamp = new Date().getTime() / 1000;
  var pow = generatePoW(nextIndex, previousBlock.hash, nextTimestamp, blockData);
  return new Block(nextIndex, previousBlock.hash, nextTimestamp, blockData, pow.hash, pow.nonce);
};

var addBlock = (newBlock) => {
  if (isValidNewBlock(newBlock, getLatestBlock())) {
    blockchain.push(newBlock);
  }
};

var isValidNewBlock = (newBlock, previousBlock) => {
  if (previousBlock.index + 1 !== newBlock.index) {
    console.log('invalid index');
    return false;
  } else if (previousBlock.hash !== newBlock.previousHash) {
    console.log('invalid previous hash');
    return false;
  } else if (calculateHashForBlock(newBlock) !== newBlock.hash) {
    console.log(typeof (newBlock.hash) + ' ' + typeof calculateHashForBlock(newBlock));
    console.log('invalid hash: ' + calculateHashForBlock(newBlock) + ' ' + newBlock.hash);
    return false;
  }
  return true;
};

var connectToPeers = (newPeers) => {
  newPeers.forEach((peer) => {
    var ws = new WebSocket(peer);
    ws.on('open', () => initConnection(ws));
    ws.on('error', () => {
      console.log('connection failed')
    });
  });
};

var handleBlockchainResponse = (message) => {
  var receivedBlocks = JSON.parse(message.data).sort((b1, b2) => (b1.index > b2.index));
  var latestBlockReceived = receivedBlocks[receivedBlocks.length - 1];
  var latestBlockHeld = getLatestBlock();
  if (latestBlockReceived.index > latestBlockHeld.index) {
    console.log('blockchain possibly behind. We got: ' + latestBlockHeld.index + ' Peer got: ' + latestBlockReceived.index);
    if (latestBlockHeld.hash === latestBlockReceived.previousHash) {
      console.log("We can append the received block to our chain");
      blockchain.push(latestBlockReceived);
      broadcast(responseLatestMsg());
      processEachTxn(latestBlockReceived);
    } else if (receivedBlocks.length === 1) {
      console.log("We have to query the chain from our peer");
      broadcast(queryAllMsg());
    } else {
      console.log("Received blockchain is longer than current blockchain");
      replaceChain(receivedBlocks);
      broadcast(queryAllTxns());
    }
  } else {
    console.log('received blockchain is not longer than received blockchain. Do nothing');
  }
};

var handleNewTxns = (message, alreadyMined) => {
  var newTxns = JSON.parse(message.data);
  for (var hash in newTxns) {
    addTransaction(newTxns[hash], alreadyMined);
  }
}

var replaceChain = (newBlocks) => {
  if (isValidChain(newBlocks) && newBlocks.length > blockchain.length) {
    console.log('Received blockchain is valid. Replacing current blockchain with received blockchain');
    blockchain = newBlocks;
    broadcast(responseLatestMsg());
  } else {
    console.log('Received blockchain invalid');
  }
};

var isValidChain = (blockchainToValidate) => {
  if (JSON.stringify(blockchainToValidate[0]) !== JSON.stringify(getGenesisBlock())) {
    return false;
  }
  var tempBlocks = [blockchainToValidate[0]];
  for (var i = 1; i < blockchainToValidate.length; i++) {
    if (isValidNewBlock(blockchainToValidate[i], tempBlocks[i - 1])) {
      tempBlocks.push(blockchainToValidate[i]);
    } else {
      return false;
    }
  }
  return true;
};

var getLatestBlock = () => blockchain[blockchain.length - 1];
var queryChainLengthMsg = () => ({'type': MessageType.QUERY_LATEST});
var queryAllMsg = () => ({'type': MessageType.QUERY_ALL});
var queryAllTxns = () => ({'type': MessageType.QUERY_ALL_TXNS});
var queryTxn = (hash) => ({'type': MessageType.QUERY_TXN, data: hash});
var responseChainMsg = () =>({
  'type': MessageType.RESPONSE_BLOCKCHAIN, 'data': JSON.stringify(blockchain)
});
var responseLatestMsg = () => ({
  'type': MessageType.RESPONSE_BLOCKCHAIN,
  'data': JSON.stringify([getLatestBlock()])
});

var processEachTxn = (block) => {
  var txns = block.data.txns;
  txns.forEach((hash) => {
    if (!Transaction.list[hash]) {
      console.log('transaction missing: ' + hash);
      broadcast(queryTxn(hash));
    } else {
      unstageTransaction(hash);
    }
  });
};

var handleTxnsQuery = (ws, msg) => {
  if (msg && msg.data) {
    if (Transaction.list[msg.data]) {
      write(ws, {
        type: MessageType.RESPONSE_TXNS,
        data: JSON.stringify({ hash: Transaction.list[msg.data] })
      });
    }
  } else {
    write(ws, {
      type: MessageType.RESPONSE_TXNS,
      data: JSON.stringify(Transaction.list)
    });
  }
};

var write = (ws, message) => ws.send(JSON.stringify(message));
var broadcast = (message) => sockets.forEach(socket => write(socket, message));

connectToPeers(initialPeers);
initHttpServer();
initP2PServer();
