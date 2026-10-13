import { MemoryStore } from '../src/memory/memory-store.js';
import { defineStoreScenarios } from '../src/testing/index.js';

defineStoreScenarios('MemoryStore', async () => ({ store: new MemoryStore(), close: async () => undefined }));
