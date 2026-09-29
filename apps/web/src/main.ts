import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { app } from './lib/state.svelte';
import { miseAJour } from './lib/miseAJour.svelte';
import { installation } from './lib/installation.svelte';
import { isNative } from './lib/platform';

// Avant tout le reste : le navigateur peut signaler tôt qu'il sait installer la page (#194).
if (!isNative) installation.demarrer();
void app.init();
miseAJour.demarrer();

export default mount(App, { target: document.getElementById('app')! });
