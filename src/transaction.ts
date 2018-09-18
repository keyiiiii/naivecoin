import CryptoJS from 'crypto-js';
import ecdsa from 'elliptic';
import _ from 'lodash';
import { MINING } from './constant';

const ec = new ecdsa.ec('secp256k1');

class UnspentTxOut {
  public readonly txHash: string;
  public readonly txOutIndex: number;
  public readonly address: string;
  public readonly amount: number;
  public readonly assetId: string;

  constructor(
    txHash: string,
    txOutIndex: number,
    address: string,
    amount: number,
    assetId: string,
  ) {
    this.txHash = txHash;
    this.txOutIndex = txOutIndex;
    this.address = address;
    this.amount = amount;
    this.assetId = assetId;
  }
}

class TxIn {
  public txHash: string;
  public txOutIndex: number;
  public signature: string;
  public assetId: string;
}

class TxOut {
  public address: string;
  public amount: number;
  public assetId: string;

  constructor(address: string, amount: number, assetId: string) {
    this.address = address;
    this.amount = amount;
    this.assetId = assetId;
  }
}

class Transaction {
  public id: string;

  public txIns: TxIn[];
  public txOuts: TxOut[];
}

const getTransactionId = (transaction: Transaction): string => {
  const txInContent: string = transaction.txIns
    .map((txIn: TxIn) => txIn.txHash + txIn.txOutIndex)
    .reduce((a, b) => a + b, '');

  const txOutContent: string = transaction.txOuts
    .map((txOut: TxOut) => txOut.address + txOut.amount)
    .reduce((a, b) => a + b, '');

  return CryptoJS.SHA256(txInContent + txOutContent).toString();
};

const validateTransaction = (
  transaction: Transaction,
  aUnspentTxOuts: UnspentTxOut[],
): boolean => {
  if (!isValidTransactionStructure(transaction)) {
    return false;
  }

  if (getTransactionId(transaction) !== transaction.id) {
    console.log('invalid tx id: ' + transaction.id);
    return false;
  }
  const hasValidTxIns: boolean = transaction.txIns
    .map((txIn: TxIn) => validateTxIn(txIn, transaction, aUnspentTxOuts))
    .reduce((a, b) => a && b, true);

  if (!hasValidTxIns) {
    console.log('some of the txIns are invalid in tx: ' + transaction.id);
    return false;
  }

  const totalTxInValues: number = transaction.txIns
    .map((txIn: TxIn) => getTxInAmount(txIn, aUnspentTxOuts))
    .reduce((a, b) => a + b, 0);

  const totalTxOutValues: number = transaction.txOuts
    .map((txOut: TxOut) => txOut.amount)
    .reduce((a, b) => a + b, 0);

  if (totalTxOutValues !== totalTxInValues) {
    console.log(
      'totalTxOutValues !== totalTxInValues in tx: ' + transaction.id,
    );
    return false;
  }

  return true;
};

const validateBlockTransactions = (
  aTransactions: Transaction[],
  aUnspentTxOuts: UnspentTxOut[],
  blockIndex: number,
): boolean => {
  const coinbaseTx = aTransactions[0];
  if (!validateCoinbaseTx(coinbaseTx, blockIndex)) {
    console.log('invalid coinbase transaction: ' + JSON.stringify(coinbaseTx));
    return false;
  }

  // check for duplicate txIns. Each txIn can be included only once
  const txIns: TxIn[] = _(aTransactions)
    .map((tx: Transaction) => tx.txIns)
    .flatten()
    .value();

  if (hasDuplicates(txIns)) {
    return false;
  }

  // all but coinbase transactions
  const normalTransactions: Transaction[] = aTransactions.slice(1);
  return normalTransactions
    .map((tx: Transaction) => validateTransaction(tx, aUnspentTxOuts))
    .reduce((a, b) => a && b, true);
};

const hasDuplicates = (txIns: TxIn[]): boolean => {
  const groups = _.countBy(
    txIns,
    (txIn: TxIn) => txIn.txHash + txIn.txOutIndex,
  );
  return _(groups)
    .map((value, key) => {
      if (value > 1) {
        console.log('duplicate txIn: ' + key);
        return true;
      } else {
        return false;
      }
    })
    .includes(true);
};

const validateCoinbaseTx = (
  transaction: Transaction,
  blockIndex: number,
): boolean => {
  if (transaction === null) {
    console.log(
      'the first transaction in the block must be coinbase transaction',
    );
    return false;
  }
  if (getTransactionId(transaction) !== transaction.id) {
    console.log('invalid coinbase tx id: ' + transaction.id);
    return false;
  }
  if (transaction.txIns.length !== 1) {
    console.log('one txIn must be specified in the coinbase transaction');
    return false;
  }
  if (transaction.txIns[0].txOutIndex !== blockIndex) {
    console.log('the txIn signature in coinbase tx must be the block height');
    return false;
  }
  if (transaction.txOuts.length !== 1) {
    console.log('invalid number of txOuts in coinbase transaction');
    return false;
  }
  if (transaction.txOuts[0].amount !== MINING.COINBASE_AMOUNT) {
    console.log('invalid coinbase amount in coinbase transaction');
    return false;
  }
  return true;
};

const validateTxIn = (
  txIn: TxIn,
  transaction: Transaction,
  aUnspentTxOuts: UnspentTxOut[],
): boolean => {
  const referencedUTxOut: UnspentTxOut = aUnspentTxOuts.find(
    (uTxO: UnspentTxOut) =>
      uTxO.txHash === txIn.txHash && uTxO.txOutIndex === txIn.txOutIndex,
  );
  if (referencedUTxOut === null) {
    console.log('referenced txOut not found: ' + JSON.stringify(txIn));
    return false;
  }
  const address = referencedUTxOut.address;

  const key = ec.keyFromPublic(address, 'hex');
  const validSignature: boolean = key.verify(transaction.id, txIn.signature);
  if (!validSignature) {
    console.log(
      'invalid txIn signature: %s txId: %s address: %s',
      txIn.signature,
      transaction.id,
      referencedUTxOut.address,
    );
    return false;
  }
  return true;
};

const getTxInAmount = (txIn: TxIn, aUnspentTxOuts: UnspentTxOut[]): number => {
  return findUnspentTxOut(txIn.txHash, txIn.txOutIndex, aUnspentTxOuts).amount;
};

const findUnspentTxOut = (
  transactionId: string,
  index: number,
  aUnspentTxOuts: UnspentTxOut[],
): UnspentTxOut => {
  return aUnspentTxOuts.find(
    (uTxO: UnspentTxOut) =>
      uTxO.txHash === transactionId && uTxO.txOutIndex === index,
  );
};

const getCoinbaseTransaction = (
  address: string,
  blockIndex: number,
): Transaction => {
  const t = new Transaction();
  const txIn: TxIn = new TxIn();
  txIn.signature = '';
  txIn.txHash = '';
  txIn.txOutIndex = blockIndex;
  txIn.assetId = MINING.ASSET_ID;

  t.txIns = [txIn];
  t.txOuts = [new TxOut(address, MINING.COINBASE_AMOUNT, MINING.ASSET_ID)];
  t.id = getTransactionId(t);
  return t;
};

const signTxIn = (
  transaction: Transaction,
  txInIndex: number,
  privateKey: string,
  aUnspentTxOuts: UnspentTxOut[],
): string => {
  const txIn: TxIn = transaction.txIns[txInIndex];

  const dataToSign = transaction.id;
  const referencedUnspentTxOut: UnspentTxOut = findUnspentTxOut(
    txIn.txHash,
    txIn.txOutIndex,
    aUnspentTxOuts,
  );
  if (referencedUnspentTxOut === null) {
    console.log('could not find referenced txOut');
    throw Error();
  }
  const referencedAddress = referencedUnspentTxOut.address;

  if (getPublicKey(privateKey) !== referencedAddress) {
    console.log(
      'trying to sign an input with private' +
        ' key that does not match the address that is referenced in txIn',
    );
    throw Error();
  }
  const key = ec.keyFromPrivate(privateKey, 'hex');
  return toHexString(key.sign(dataToSign).toDER());
};

const updateUnspentTxOuts = (
  aTransactions: Transaction[],
  aUnspentTxOuts: UnspentTxOut[],
): UnspentTxOut[] => {
  const newUnspentTxOuts: UnspentTxOut[] = aTransactions
    .map((t: Transaction) => {
      return t.txOuts.map(
        (txOut, index) =>
          new UnspentTxOut(
            t.id,
            index,
            txOut.address,
            txOut.amount,
            txOut.assetId,
          ),
      );
    })
    .reduce((a, b) => a.concat(b), []);

  const consumedTxOuts: UnspentTxOut[] = aTransactions
    .map((t: Transaction) => t.txIns)
    .reduce((a, b) => a.concat(b), [])
    .map(
      (txIn: TxIn) =>
        new UnspentTxOut(txIn.txHash, txIn.txOutIndex, '', 0, txIn.assetId),
    );

  return aUnspentTxOuts
    .filter(
      (uTxO: UnspentTxOut) =>
        !findUnspentTxOut(uTxO.txHash, uTxO.txOutIndex, consumedTxOuts),
    )
    .concat(newUnspentTxOuts);
};

const processTransactions = (
  aTransactions: Transaction[],
  aUnspentTxOuts: UnspentTxOut[],
  blockIndex: number,
) => {
  if (!validateBlockTransactions(aTransactions, aUnspentTxOuts, blockIndex)) {
    console.log('invalid block transactions');
    return null;
  }
  return updateUnspentTxOuts(aTransactions, aUnspentTxOuts);
};

const toHexString = (byteArray): string => {
  return Array.from(byteArray, (byte: any) => {
    // tslint:disable:prettier
    return ('0' + (byte & 0xFF).toString(16)).slice(-2);
  }).join('');
  // tslint:enable:prettier
};

const getPublicKey = (aPrivateKey: string): string => {
  return ec
    .keyFromPrivate(aPrivateKey, 'hex')
    .getPublic()
    .encode('hex');
};

const isValidTxInStructure = (txIn: TxIn): boolean => {
  if (txIn === null) {
    console.log('txIn is null');
    return false;
  } else if (typeof txIn.signature !== 'string') {
    console.log('invalid signature type in txIn');
    return false;
  } else if (typeof txIn.txHash !== 'string') {
    console.log('invalid txHash type in txIn');
    return false;
  } else if (typeof txIn.txOutIndex !== 'number') {
    console.log('invalid txOutIndex type in txIn');
    return false;
  } else {
    return true;
  }
};

const isValidTxOutStructure = (txOut: TxOut): boolean => {
  if (txOut === null) {
    console.log('txOut is null');
    return false;
  } else if (typeof txOut.address !== 'string') {
    console.log('invalid address type in txOut');
    return false;
  } else if (!isValidAddress(txOut.address)) {
    console.log('invalid TxOut address');
    return false;
  } else if (typeof txOut.amount !== 'number') {
    console.log('invalid amount type in txOut');
    return false;
  } else {
    return true;
  }
};

const isValidTransactionStructure = (transaction: Transaction) => {
  if (typeof transaction.id !== 'string') {
    console.log('transactionId missing');
    return false;
  }
  if (!(transaction.txIns instanceof Array)) {
    console.log('invalid txIns type in transaction');
    return false;
  }
  if (
    !transaction.txIns.map(isValidTxInStructure).reduce((a, b) => a && b, true)
  ) {
    return false;
  }

  if (!(transaction.txOuts instanceof Array)) {
    console.log('invalid txIns type in transaction');
    return false;
  }

  if (
    !transaction.txOuts
      .map(isValidTxOutStructure)
      .reduce((a, b) => a && b, true)
  ) {
    return false;
  }
  return true;
};

// valid address is a valid ecdsa public key in the 04 + X-coordinate + Y-coordinate format
const isValidAddress = (address: string): boolean => {
  if (address.length !== 130) {
    console.log(address);
    console.log('invalid public key length');
    return false;
  } else if (address.match('^[a-fA-F0-9]+$') === null) {
    console.log('public key must contain only hex characters');
    return false;
  } else if (!address.startsWith('04')) {
    console.log('public key must start with 04');
    return false;
  }
  return true;
};

export {
  processTransactions,
  signTxIn,
  getTransactionId,
  isValidAddress,
  validateTransaction,
  UnspentTxOut,
  TxIn,
  TxOut,
  getCoinbaseTransaction,
  getPublicKey,
  hasDuplicates,
  Transaction,
};
