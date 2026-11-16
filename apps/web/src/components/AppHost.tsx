'use client';

import { useEffect, useRef } from 'react';
import { SLOT_ATTRIBUTE, SLOT_IDS } from '@freshrescue/frontend';
import type { SlotId } from '@freshrescue/frontend';
import { composeApp } from '../compose';
import type { ComposedApp } from '../compose';
import { Eyebrow, Hero, QueueHint } from './Guide';

/** The places of the page frame that hold slots. */
type Region = 'brand' | 'clock' | 'toasts' | 'inventory' | 'warnings' | 'recommendations' | 'cook' | 'categories' | 'overlays';

/**
 * Where each of the 16 slots of the `ui` contract sits. The record needs every slot id, so a slot that the
 * contract adds cannot be left off the page: it would not compile. Which slot shows is still the frame's
 * call (AppShellView's slot directives); this only says where a slot is when it does.
 *
 * - brand: the frame itself, the name and the tab bar. A sidebar on a wide screen, a top bar with a tab bar
 *   at the bottom on a narrow one.
 * - clock: the Simulated Today control, at the foot of the sidebar or the end of the top bar.
 * - toasts: the notices, which float above everything, the dialogs included, because a refused deletion
 *   keeps its dialog open and its notice must still be seen.
 * - the five tabs, one section each. The cook queue sits beside the recipe catalog, where Cook & Deduct is.
 * - overlays: the forms, the confirmations and the cook report, which open as sheets over the page.
 */
const REGION_OF: Record<SlotId, Region> = {
  shell: 'brand',
  demo: 'clock',
  notices: 'toasts',
  inventoryList: 'inventory',
  foodTypeDetail: 'inventory',
  warnings: 'warnings',
  recommendations: 'recommendations',
  catalog: 'cook',
  cookQueue: 'cook',
  categories: 'categories',
  batchForm: 'overlays',
  foodTypeForm: 'overlays',
  unitConversion: 'overlays',
  recipeForm: 'overlays',
  confirm: 'overlays',
  cookReport: 'overlays',
};

/** The empty slot elements of one region, in the order of the contract, for the DOM host to paint into. */
function Slots({ region }: { readonly region: Region }) {
  return SLOT_IDS.filter((slot) => REGION_OF[slot] === region).map((slot) => <div key={slot} {...{ [SLOT_ATTRIBUTE]: slot }} />);
}

/**
 * The React shell that mounts the app (plan, phase 9). It renders the page frame with the 16 empty slots in
 * it, starts the app when it mounts and stops it when it unmounts. React never touches what is inside the
 * slots: the DOM host paints them and shows or hides them, and globals.css styles what it paints. The frame
 * adds only static words around them (the guide, see Guide.tsx), and a section's words hide with its slot.
 * Until the first frame is painted, the page shows the logo instead of empty slots. The app is created
 * once, in the browser, so React's development double mount (start, stop, start) runs one app, with one
 * set of page listeners and one timer.
 */
export function AppHost() {
  const app = useRef<ComposedApp | null>(null);
  useEffect(() => {
    app.current ??= composeApp();
    const running = app.current;
    running.start();
    return () => running.stop();
  }, []);
  return (
    <div className="fr-root">
      <div className="fr-scenery" aria-hidden="true" />
      <div className="fr-boot" aria-hidden="true">
        <span className="fr-boot__mark bg-logo" />
      </div>
      <div className="fr-app">
        <header className="fr-header">
          <Slots region="brand" />
          <div className="fr-clock">
            <p className="fr-clock__label">Demo clock</p>
            <Slots region="clock" />
          </div>
        </header>
        <main className="fr-main">
          <section className="fr-section fr-section--inventory" aria-label="Inventory">
            <Hero />
            <Slots region="inventory" />
          </section>
          <section className="fr-section fr-section--warnings" aria-label="Warnings">
            <Eyebrow glyph="bell" step="Step 2 · Watch" note="Use these first" />
            <Slots region="warnings" />
          </section>
          <section className="fr-section fr-section--recommendations" aria-label="Recommendations">
            <Eyebrow glyph="buoy" step="Step 3 · Rescue" note="Recipes for food that is about to expire" />
            <Slots region="recommendations" />
          </section>
          <section className="fr-section fr-section--cook" aria-label="Recipes">
            <Eyebrow glyph="pot" step="Step 4 · Cook" note="Ingredients come out of the batch that expires first" />
            <div className="fr-cook">
              <Slots region="cook" />
              <QueueHint />
            </div>
          </section>
          <section className="fr-section fr-section--categories" aria-label="Categories">
            <Eyebrow glyph="tag" step="Set-up" note="Group your food and tune its near-expiry thresholds" />
            <Slots region="categories" />
          </section>
        </main>
        <Slots region="toasts" />
        <div className="fr-overlays">
          <Slots region="overlays" />
        </div>
      </div>
    </div>
  );
}
