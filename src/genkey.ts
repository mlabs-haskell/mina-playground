import { command, option, string, run } from "cmd-ts";
import { PrivateKey } from "snarkyjs";
import fs from 'fs/promises';

await run(command({
  name: "genkey",
  args: {
    output: option({
      long: "output",
      short: 'o',
      defaultValue: () => "./key.json",
      type: string,
    }),
  },
  handler: async (args) => {
    const privateKey = PrivateKey.random();
    const publicKey = privateKey.toPublicKey();
    const keyJson = JSON.stringify({
      privateKey: privateKey.toBase58(),
      publicKey: publicKey.toBase58()
    });
    await fs.writeFile(args.output, keyJson);
  }
}), process.argv.slice(2));