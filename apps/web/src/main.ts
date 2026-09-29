import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { app } from './lib/state.svelte';
import { miseAJour } from './lib/miseAJour.svelte';

void app.init();
miseAJour.demarrer();

export default mount(App, { target: document.getElementById('app')! });
