import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { app } from './lib/state.svelte';

void app.init();

export default mount(App, { target: document.getElementById('app')! });
