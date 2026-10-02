/**
 * Tests du codeur de #306 que l'auditeur n'a pas retenus dans le harnais (`reprise-harnais.test.ts`) :
 * niveau 4, un diagnostic. Les autres y sont passés, ou y ont une épreuve plus forte.
 */
import { describe, expect, it } from 'vitest';
import * as cœur from '../src/index.js';

describe('[niveau 4] #306 · point 5 — le cœur ne sait plus engendrer un automatisme à partir d’un flux', () => {
  it('automationFromFlow et syncFlowAutomations ne sont plus exportés', () => {
    expect('automationFromFlow' in cœur || 'syncFlowAutomations' in cœur).toBe(false);
  });
});
