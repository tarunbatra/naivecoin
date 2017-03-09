# Naivechain - a blockchain implementation in 200 lines of code

### Motivation
All the current implementations of blockchains are tightly coupled with the larger context and problems they (e.g. Bitcoin or Ethereum) are trying to solve. This makes understanding blockchains a necessarily harder task, than it must be. Especially source-code-wisely. This project is an attempt to provide as concise and simple implementation of a blockchain as possible.


### What is blockchain
[From Wikipedia](https://en.wikipedia.org/wiki/Blockchain_(database)) : Blockchain is a distributed database that maintains a continuously-growing list of records called blocks secured from tampering and revision.

### Key concepts of Naivechain
Check also [this blog post](https://medium.com/@lhartikk/a-blockchain-in-200-lines-of-code-963cc1cc0e54#.dttbm9afr5) for a more detailed overview of the key concepts
* HTTP interface to control the node
* Use Websockets to communicate with other nodes (P2P)
* Super simple "protocols" in P2P communication
* Data is not persisted in nodes
* No proof-of-work or proof-of-stake: a block can be added to the blockchain without competition


![alt tag](naivechain_blockchain.png)

![alt tag](naivechain_components.png)

### Quick start
(set up two connected nodes and mine 1 block)
```
npm install
HTTP_PORT=3001 P2P_PORT=6001 npm start
HTTP_PORT=3002 P2P_PORT=6002 PEERS=ws://localhost:6001 npm start
curl -H "Content-type:application/json" --data '{"data" : "Some data to the first block"}' http://localhost:3001/mineBlock
```

### Quick start with Docker
(set up three connected nodes and mine a block)
###
```sh
docker-compose up
curl -H "Content-type:application/json" --data '{"data" : "Some data to the first block"}' http://localhost:3001/mineBlock
```

### HTTP API
##### Get blockchain
```sh
curl http://localhost:3001/blocks
```
##### Get single block
```sh
curl http://localhost:3001/block/:id
```
##### Get transactions
```sh
curl http://localhost:3001/transactions
```
##### Get single transaction
```sh
curl http://localhost:3001/transaction/:id
```
##### Get accounts
```sh
curl http://localhost:3001/accounts
```
##### Get single account
```sh
curl http://localhost:3001/account/:id
```
##### Get node's account
```sh
curl http://localhost:3001/my-account
```
##### Create transaction
```sh
curl -H "Content-type:application/json" --data '{ \
  "from": "<sender-address>", \
  "to": "receiver-address", \
  "value": 12 \
  }' http://localhost:3001/transact
```
##### Add peer
```sh
curl -H "Content-type:application/json" --data '{"peer" : "ws://localhost:6001"}' http://localhost:3001/addPeer
```
#### Query connected peers
```sh
curl http://localhost:3001/peers
```

#### Try to modify data in blockchain
```sh
curl -H "Content-type:application/json" --data '{"index": "2", "data": "malicious data"}' http://localhost:3001/turnMalicious
```
