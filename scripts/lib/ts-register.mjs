/**
 * Preload for the scripts/ tools:  node --import ./scripts/lib/ts-register.mjs …
 * Installs the resolve hook that lets them import src/*.ts directly.
 */
import {register} from 'node:module';

register('./ts-resolve.mjs', import.meta.url);
