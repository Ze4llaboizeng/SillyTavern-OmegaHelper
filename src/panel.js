import { createGuide } from './guide.js';
import { createPanel } from './panel-view.js';
import { createUi } from './ui.js';

export function createPanelServices(app) {
    Object.assign(app, createGuide(app));
    Object.assign(app, createPanel(app));
    Object.assign(app, createUi(app));
    return { Guide: app.Guide, Panel: app.Panel, UI: app.UI };
}

