import { Account, Mina, PrivateKey, PublicKey, UInt64 } from "snarkyjs";
import { OffchainStorage } from "../src/OffchainStorage";
import { GovernanceParameters, Governor, PROPOSAL_TREE_HEIGHT, Proposal, STAKE_TREE_HEIGHT, Stake } from "../src/Prototype";
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { FeePayerSpec } from "snarkyjs/dist/node/lib/mina";

function proposalStorageToJson(proposalTree: OffchainStorage<Proposal>): string {
  return JSON.stringify(
    Array.from(proposalTree.entries()).map(([k, v]) =>
      [k.toString(), v]));
}

function stakeStorageToJson(stakeTree: OffchainStorage<Stake>): string {
  return JSON.stringify(
    Array.from(stakeTree.entries()).map(([k, v]) =>
      [k.toString(), v]));
}

function jsonToProposalStorage(json: string): OffchainStorage<Proposal> {
  const storage = new OffchainStorage<Proposal>(PROPOSAL_TREE_HEIGHT);
  (JSON.parse(json) as Array<[string, any]>).
    forEach(([k, v]) => storage.set(BigInt(k), new Proposal(v)));
  return storage;
}

function jsonToStakeStorage(json: string): OffchainStorage<Stake> {
  const storage = new OffchainStorage<Stake>(STAKE_TREE_HEIGHT);
  (JSON.parse(json) as Array<[string, any]>).
    forEach(([k, v]) => storage.set(BigInt(k), new Stake(v)));
  return storage;
}

export type Config = {
  networkUrl: string,
  fee: number,
  governorPublicKey?: string,
  stakeStoragePath: string,
  proposalStoragePath: string,
  userKeyPath: string
};

export class Env {
  private readonly userPrivateKey: PrivateKey;
  readonly userPublicKey: PublicKey;

  public readonly stakeStorage: OffchainStorage<Stake>;
  public readonly proposalStorage: OffchainStorage<Proposal>;

  readonly governanceParameters: GovernanceParameters =
    new GovernanceParameters({
      create: UInt64.from(100),
      quorum: UInt64.from(100_000)
    });

  private _governor?: Governor;

  private _config: Config;

  public get config(): Config { return structuredClone(this._config); }

  public set governorPublicKey(pk: PublicKey) {
    this._config.governorPublicKey = pk.toBase58();
    this._governor = new Governor(pk);
  }

  public get governor(): Governor {
    return this._governor!;
  }

  private constructor(
    userPrivateKey: PrivateKey,
    stakeStorage: OffchainStorage<Stake>,
    proposalStorage: OffchainStorage<Proposal>,
    config: Config,
    governor?: Governor
  ) {
    this.userPrivateKey = userPrivateKey;
    this.userPublicKey = userPrivateKey.toPublicKey();
    this.stakeStorage = stakeStorage;
    this.stakeStorage = stakeStorage;
    this.proposalStorage = proposalStorage;
    this._config = config;
    this._governor = governor;
  }

  submitTx = async (
    txFn: () => void,
    signedByUser: Boolean = true,
    additionalPrivateKeys: PrivateKey[] = []) => {
    const feePayerSpec: FeePayerSpec = {
      sender: this.userPublicKey,
      fee: this.config.fee * 1e9
    };
    const txn = await Mina.transaction(feePayerSpec, txFn);

    await txn.prove();

    const privateKeys = additionalPrivateKeys;
    additionalPrivateKeys
      .push(...(signedByUser ? [this.userPrivateKey] : []));

    await txn.sign(privateKeys);

    const txId = await txn.send();

    if (!txId.isSuccess)
      throw "failed to send tx";

    const txIdHash = txId.hash();

    console.log("tx sent", txIdHash);
    console.log("waiting...");

    txId.wait();


    console.log("tx confirmed");
    console.log("explorer link",
      `https://berkeley.minaexplorer.com/transaction/${txIdHash}`)
  };

  public static async withEnv<R>(app: ((env: Env) => Promise<R>),
    configFilename: string = "config.json",
    newStorage: boolean = false,
    writeBackConfig: boolean = false): Promise<R> {
    console.log("initializing...");

    const config: Config = JSON.parse(await fs.readFile(configFilename, 'utf8'));

    const network = Mina.Network(config.networkUrl);
    Mina.setActiveInstance(network);

    console.log("compiling contracts...");

    await Governor.compile();

    const userKeyBase58: { privateKey: string; publicKey: string } =
      JSON.parse(await fs.readFile(config.userKeyPath, 'utf8'));

    const userPrivateKey = PrivateKey.fromBase58(userKeyBase58.privateKey);

    const stakeStorage =
      newStorage ?
        new OffchainStorage<Stake>(STAKE_TREE_HEIGHT) :
        jsonToStakeStorage(await fs.readFile(config.stakeStoragePath, 'utf8'));

    const proposalStorage =
      newStorage ?
        new OffchainStorage<Proposal>(STAKE_TREE_HEIGHT) :
        jsonToProposalStorage(await fs.readFile(config.proposalStoragePath, 'utf8'));

    const governor =
      (config.governorPublicKey === undefined || config.governorPublicKey == "") ?
        undefined :
        new Governor(PublicKey.fromBase58(config.governorPublicKey));

    const env = new Env(
      userPrivateKey,
      stakeStorage,
      proposalStorage,
      config,
      governor);

    console.log("running app code...");

    const ret = await app(env);

    console.log("all done, finishing up");

    await fs.writeFile(
      config.stakeStoragePath,
      stakeStorageToJson(stakeStorage));

    await fs.writeFile(
      config.proposalStoragePath,
      proposalStorageToJson(proposalStorage));

    if (writeBackConfig) {
      console.log("updated config", env._config);
      await fs.writeFile(configFilename, JSON.stringify(env._config));
    }

    return ret;
  }
};