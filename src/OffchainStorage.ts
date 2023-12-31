import { Field, MerkleTree, Poseidon } from 'snarkyjs';

export { OffchainStorage };

class OffchainStorage<
  V extends {
    getHash(): Field;
  }
> extends Map<bigint, V> {
  private merkleTree;

  constructor(public readonly height: number) {
    super();
    this.merkleTree = new MerkleTree(height);
  }

  set(key: bigint, value: V): this {
    super.set(key, value);
    this.merkleTree.setLeaf(key, value.getHash());
    return this;
  }

  get(key: bigint): V | undefined {
    return super.get(key);
  }

  getWitness(key: bigint): { isLeft: boolean; sibling: Field }[] {
    return this.merkleTree.getWitness(key);
  }

  getRoot(): Field {
    return this.merkleTree.getRoot();
  }

  delete(key: bigint): boolean {
    const exists = super.delete(key);
    this.merkleTree.setLeaf(key, new Field(0));
    return exists;
  }
}
