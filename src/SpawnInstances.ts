import {
  AccountUpdate, Field, Mina, PrivateKey, PublicKey, SmartContract, State, method, state
} from "snarkyjs";

export class A extends SmartContract {
  @method spawnB(): PublicKey {
    const privateKey = PrivateKey.random();
    const publicKey = privateKey.toPublicKey();
    const contract = new B(publicKey);
    contract.deploy({ zkappKey: privateKey });
    contract.setNum(Field(4242));
    return publicKey;
  }
}

export class B extends SmartContract {
  @state(Field) num = State<Field>();

  @method setNum(value: Field) { this.num.set(value); }
}

export async function spawnA(
  contractPrivateKey: PrivateKey,
  feePayerPrivateKey: PrivateKey): Promise<A> {
  let contractPublicKey = contractPrivateKey.toPublicKey();
  let instanceOfA = new A(contractPublicKey);
  const feePayerPublicKey = feePayerPrivateKey.toPublicKey();
  const txn = await Mina.transaction(feePayerPublicKey, () => {
    AccountUpdate.fundNewAccount(feePayerPublicKey);
    instanceOfA.deploy();
  });
  await txn.prove();
  await txn.sign([feePayerPrivateKey, contractPrivateKey]).send();
  return instanceOfA;
}

export async function spawnB(
  instanceOfA: A,
  feePayerPrivateKey: PrivateKey): Promise<B> {
  let publicKeyOfB = PublicKey.empty();
  const feePayerPublicKey = feePayerPrivateKey.toPublicKey();
  const txn = await Mina.transaction(feePayerPublicKey, () => {
    AccountUpdate.fundNewAccount(feePayerPublicKey);
    publicKeyOfB = instanceOfA.spawnB();
  });
  await txn.prove();
  await txn.sign([feePayerPrivateKey]).send();
  let instanceOfB = new B(publicKeyOfB);
  return instanceOfB;
}