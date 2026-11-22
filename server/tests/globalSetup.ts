import { MongoMemoryServer } from 'mongodb-memory-server';
import type { TestProject } from 'vitest/node';

// One in-memory MongoDB for the whole run (first run downloads the binary once).
let mongo: MongoMemoryServer;

export async function setup(project: TestProject) {
  mongo = await MongoMemoryServer.create();
  project.provide('mongoUri', mongo.getUri());
}

export async function teardown() {
  await mongo?.stop();
}

declare module 'vitest' {
  export interface ProvidedContext {
    mongoUri: string;
  }
}
