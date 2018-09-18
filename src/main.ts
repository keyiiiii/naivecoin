import bodyParser from 'body-parser';
import express, { NextFunction, Request, Response } from 'express';
import _ from 'lodash';
import {
  Block,
  generateNextBlock,
  generatenextBlockWithTransaction,
  generateRawNextBlock,
  getAccountBalance,
  getBlockchain,
  getMyUnspentTransactionOutputs,
  getUnspentTxOuts,
  sendTransaction,
} from './blockchain';
import { connectToPeers, getSockets, initP2PServer } from './p2p';
import { UnspentTxOut } from './transaction';
import { getTransactionPool } from './transactionPool';
import { getPublicFromWallet, initWallet } from './wallet';

const httpPort: number = parseInt(process.env.HTTP_PORT, 10) || 3001;
const p2pPort: number = parseInt(process.env.P2P_PORT, 10) || 6001;

const initHttpServer = (myHttpPort: number) => {
  const app = express();
  app.use(bodyParser.json());

  app.use((err, _: Request, res: Response, __: NextFunction) => {
    if (err) {
      res.status(400).send(err.message);
    }
  });

  app.get('/blocks', (_: Request, res: Response) => {
    res.send(getBlockchain());
  });

  app.get('/block/:hash', (req: Request, res: Response) => {
    const block = _.find(getBlockchain(), { hash: req.params.hash });
    res.send(block);
  });

  app.get('/transaction/:id', (req: Request, res: Response) => {
    const tx = _(getBlockchain())
      .map((blocks: Block) => blocks.data)
      .flatten()
      .find({ id: req.params.id });
    res.send(tx);
  });

  app.get('/address/:address', (req: Request, res: Response) => {
    const unspentTxOuts: UnspentTxOut[] = _.filter(
      getUnspentTxOuts(),
      (uTxO: UnspentTxOut) => uTxO.address === req.params.address,
    );
    res.send({ unspentTxOuts: unspentTxOuts });
  });

  app.get('/unspentTransactionOutputs', (_: Request, res: Response) => {
    res.send(getUnspentTxOuts());
  });

  app.get('/myUnspentTransactionOutputs', (_: Request, res: Response) => {
    res.send(getMyUnspentTransactionOutputs());
  });

  app.post('/mineRawBlock', (req: Request, res: Response) => {
    if (req.body.data === null) {
      res.send('data parameter is missing');
      return;
    }
    const newBlock: Block = generateRawNextBlock(req.body.data);
    if (newBlock === null) {
      res.status(400).send('could not generate block');
    } else {
      res.send(newBlock);
    }
  });

  app.post('/mineBlock', (_: Request, res: Response) => {
    const newBlock: Block = generateNextBlock();
    if (newBlock === null) {
      res.status(400).send('could not generate block');
    } else {
      res.send(newBlock);
    }
  });

  app.get('/balance', (_: Request, res: Response) => {
    const balance: number = getAccountBalance();
    res.send({ balance: balance });
  });

  app.get('/address', (_: Request, res: Response) => {
    const address: string = getPublicFromWallet();
    res.send({ address: address });
  });

  app.post('/mineTransaction', (req: Request, res: Response) => {
    const address = req.body.address;
    const amount = req.body.amount;
    const assetId = req.body.assetId;
    try {
      const resp = generatenextBlockWithTransaction(address, amount, assetId);
      res.send(resp);
    } catch (e) {
      console.log(e.message);
      res.status(400).send(e.message);
    }
  });

  app.post('/sendTransaction', (req: Request, res: Response) => {
    try {
      const address = req.body.address;
      const amount = req.body.amount;
      const assetId = req.body.assetId;

      if (address === undefined || amount === undefined) {
        throw Error('invalid address or amount');
      }
      const resp = sendTransaction(address, amount, assetId);
      res.send(resp);
    } catch (e) {
      console.log(e.message);
      res.status(400).send(e.message);
    }
  });

  app.get('/transactionPool', (_: Request, res: Response) => {
    res.send(getTransactionPool());
  });

  app.get('/peers', (_: Request, res: Response) => {
    res.send(
      getSockets().map(
        (s: any) => s._socket.remoteAddress + ':' + s._socket.remotePort,
      ),
    );
  });
  app.post('/addPeer', (req: Request, res: Response) => {
    connectToPeers(req.body.peer);
    res.send();
  });

  app.post('/stop', (_: Request, res: Response) => {
    res.send({ msg: 'stopping server' });
    process.exit();
  });

  app.listen(myHttpPort, () => {
    console.log('Listening http on port: ' + myHttpPort);
  });
};

initHttpServer(httpPort);
initP2PServer(p2pPort);
initWallet();
