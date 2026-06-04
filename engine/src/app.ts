import { Engine } from './core/engine';
import './ui/search';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const engine = new Engine(canvas);
engine.init().catch(console.error);
(window as any).__engine = engine;
