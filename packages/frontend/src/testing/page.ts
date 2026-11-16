import { expect } from 'vitest';
import { SLOT_IDS } from '@freshrescue/contract-ui';
import type { SlotId } from '@freshrescue/contract-ui';
import { createAppCoordinator } from '../coordinators/AppCoordinator';
import { createDomHostGateway, SLOT_ATTRIBUTE } from '../gateways/domHostGateway';
import type { MidnightTimerPort } from '../gateways/midnightTimerGateway';
import { createFakeApi, okReply } from './fakeApi';
import type { FakeApi, Script } from './fakeApi';
import { CATALOG, COOK_REPORT, DETAIL, INVENTORY, RECOMMENDATIONS, REFERENCE, WARNINGS } from './fixtures';

// The page in jsdom, for the tests of the coordinators: the 16 slot elements that AppHost renders, the
// app on the stand-in API, and helpers that click, type and choose on the painted page the way a person
// does, so a test starts from one event and reads what was painted. This is a builder for tests: it is
// not a module, and production code never imports it.

/** Puts the empty slot elements of AppHost into the page, and returns a function that takes them out again. */
export function addSlots(slots: readonly SlotId[] = SLOT_IDS): () => void {
  const elements = slots.map((slot) => {
    const element = document.createElement('div');
    element.setAttribute(SLOT_ATTRIBUTE, slot);
    document.body.append(element);
    return element;
  });
  return () => elements.forEach((element) => element.remove());
}

export function slotElement(slot: SlotId): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[${SLOT_ATTRIBUTE}="${slot}"]`);
  if (element === null) expect.unreachable(`the page has no slot "${slot}"`);
  return element;
}

/** Whether a slot shows: the frame hides the slots of the other tabs. */
export const isShown = (slot: SlotId): boolean => !slotElement(slot).hidden;

/** The texts that a slot shows, in the order of the page: each text, each button label and each caption and hint of a field. */
export function textsOf(slot: SlotId): string[] {
  return [...slotElement(slot).querySelectorAll<HTMLElement>('span, button')]
    .filter((element) => element.tagName === 'BUTTON' || element.closest('button') === null)
    .filter((element) => element.closest('[hidden]') === null)
    .map((element) => element.textContent ?? '')
    .filter((text) => text !== '');
}

type Where = { readonly slot?: SlotId; readonly nth?: number };

const within = (where: Where): ParentNode => (where.slot === undefined ? document : slotElement(where.slot));

/** The painted button with this label, the first unless `nth` says otherwise. */
export function buttonOf(label: string, where: Where = {}): HTMLButtonElement {
  const found = [...within(where).querySelectorAll('button')].filter((button) => button.textContent === label)[where.nth ?? 0];
  if (found === undefined) expect.unreachable(`no button "${label}" on the page`);
  return found;
}

/** The control of the painted field with this caption. */
function controlOf(caption: string, where: Where): HTMLInputElement | HTMLSelectElement {
  const labels = [...within(where).querySelectorAll('label')].filter((label) => label.querySelector('span')?.textContent === caption);
  const control = labels[where.nth ?? 0]?.querySelector('input, select');
  if (!(control instanceof HTMLInputElement) && !(control instanceof HTMLSelectElement)) expect.unreachable(`no field "${caption}" on the page`);
  return control;
}

export function inputOf(caption: string, where: Where = {}): HTMLInputElement {
  const control = controlOf(caption, where);
  if (!(control instanceof HTMLInputElement)) expect.unreachable(`the field "${caption}" is not a text field`);
  return control;
}

export function selectOf(caption: string, where: Where = {}): HTMLSelectElement {
  const control = controlOf(caption, where);
  if (!(control instanceof HTMLSelectElement)) expect.unreachable(`the field "${caption}" is not a drop-down`);
  return control;
}

/** The hint beside a field, or '' when there is none. */
export const hintOf = (caption: string, where: Where = {}): string => {
  const hint = controlOf(caption, where).nextElementSibling;
  return hint instanceof HTMLElement && !hint.hidden ? (hint.textContent ?? '') : '';
};

export function click(label: string, where: Where = {}): void {
  buttonOf(label, where).click();
}

/** Types a text into a field, as a person does: the field holds it, and an `input` event goes up the page. */
export function typeInto(caption: string, text: string, where: Where = {}): void {
  const input = inputOf(caption, where);
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Chooses an entry of a drop-down by its value, as a person does: a `change` event goes up the page. */
export function choose(caption: string, value: string, where: Where = {}): void {
  const select = selectOf(caption, where);
  if (![...select.options].some((option) => option.value === value)) expect.unreachable(`the drop-down "${caption}" has no entry ${value}`);
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Lets the page settle: the stand-in API sets no timer, so everything that one event started has finished by the next turn of the event loop. */
export const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export type FakeTimer = MidnightTimerPort & {
  /** What the midnight timer does at local 00:00. */
  fire(): void;
  /** How many subscriptions are active. */
  subscribers(): number;
};

/** A midnight timer that a test fires by hand. The real one is tested on its own, with fake timers. */
export function createFakeTimer(): FakeTimer {
  const callbacks = new Set<() => void>();
  return {
    subscribe(callback) {
      const each = (): void => callback();
      callbacks.add(each);
      return () => callbacks.delete(each);
    },
    fire: () => callbacks.forEach((callback) => callback()),
    subscribers: () => callbacks.size,
  };
}

/** The replies of a world with the data of the fixtures: every query answers its fixture, and every command works. */
export const WORLD: Script = {
  GetReferenceData: okReply('GetReferenceData', REFERENCE),
  GetInventoryList: okReply('GetInventoryList', INVENTORY),
  GetFoodTypeDetail: okReply('GetFoodTypeDetail', DETAIL),
  GetWarningPanel: okReply('GetWarningPanel', WARNINGS),
  GetRecommendations: okReply('GetRecommendations', RECOMMENDATIONS),
  GetCatalog: okReply('GetCatalog', CATALOG),
  SaveCategory: okReply('SaveCategory', { categoryId: 50 }),
  DeleteCategory: okReply('DeleteCategory', {}),
  SetCategoryThreshold: okReply('SetCategoryThreshold', {}),
  SaveFoodType: okReply('SaveFoodType', { foodTypeId: 51 }),
  ChangeFoodTypeUnit: okReply('ChangeFoodTypeUnit', {}),
  DeleteFoodType: okReply('DeleteFoodType', {}),
  InboundBatch: okReply('InboundBatch', {}),
  EditBatchQuantity: okReply('EditBatchQuantity', {}),
  RemoveBatch: okReply('RemoveBatch', {}),
  SaveRecipe: okReply('SaveRecipe', { recipeId: 52 }),
  DeleteRecipe: okReply('DeleteRecipe', {}),
  CookRecipes: okReply('CookRecipes', COOK_REPORT),
  SetSimulatedToday: okReply('SetSimulatedToday', {}),
};

export type Page = {
  readonly api: FakeApi;
  readonly app: ReturnType<typeof createAppCoordinator>;
  readonly timer: FakeTimer;
  /** Stops the app and takes the slots out of the page. */
  close(): void;
};

/**
 * Opens the app the way AppHost does, on the 16 slots, the real DOM host, the stand-in API answering
 * `script` (on top of the world) and a midnight timer fired by hand, and waits for the first screen.
 */
export async function openPage(script: Script = {}): Promise<Page> {
  const api = createFakeApi({ ...WORLD, ...script });
  const timer = createFakeTimer();
  const removeSlots = addSlots();
  const app = createAppCoordinator({ api, dom: createDomHostGateway(), timer });
  await app.start();
  await settle();
  return {
    api,
    app,
    timer,
    close: () => {
      app.stop();
      removeSlots();
    },
  };
}
