import { describe, expect, it } from 'vitest';
import type { RenderTree, UiEventDescriptor } from '@freshrescue/contract-ui';
import { editedFieldsOf, eventsOf, findButton, nodesOf, problemsOf, renderText } from './render';

// The tests of the views read their trees through these helpers, and trust `problemsOf` to say when a
// tree is not fit to paint. A check that can never fail proves nothing, so this gives it trees that
// are wrong in each way and trees that are right.

const OK_EVENT: UiEventDescriptor = { ns: 'batch', name: 'edit', payload: { field: 'quantity' } };

const TREE: RenderTree = {
  kind: 'box',
  layout: 'stack',
  children: [
    { kind: 'text', text: 'Inventory', tone: 'title' },
    { kind: 'button', label: 'Add batch', event: { ns: 'inventory', name: 'addBatch', payload: { foodTypeId: null } } },
    { kind: 'button', label: 'Save', tone: 'bad', disabled: true, event: { ns: 'batch', name: 'submit', payload: {} } },
    { kind: 'input', label: 'Quantity', value: '1.5', hint: 'Use digits', event: OK_EVENT },
    { kind: 'input', label: 'Date', value: '', inputType: 'date', disabled: true, event: OK_EVENT },
    { kind: 'select', label: 'Unit', value: 'ml', choices: [{ value: 'grams', label: 'grams' }, { value: 'ml', label: 'ml' }], event: OK_EVENT },
    { kind: 'slot', slot: 'catalog', shown: true },
    { kind: 'slot', slot: 'warnings', shown: false },
    { kind: 'box', layout: 'row', tone: 'info', children: [{ kind: 'text', text: 'inside' }] },
  ],
};

describe('testing/render', () => {
  describe('renderText', () => {
    it('prints one node to a line, indented by its depth', () => {
      expect(renderText(TREE)).toBe(
        [
          'box stack',
          '  text: Inventory (title)',
          '  button: Add batch -> inventory/addBatch',
          '  button: Save (bad) disabled -> batch/submit',
          '  input Quantity: 1.5 [Use digits] -> batch/edit',
          '  input Date:  date disabled -> batch/edit',
          '  select Unit: ml of grams, ml -> batch/edit',
          '  slot catalog shown',
          '  slot warnings hidden',
          '  box row (info)',
          '    text: inside',
        ].join('\n'),
      );
    });
  });

  describe('nodesOf, eventsOf and findButton', () => {
    it('lists every node, depth first, the root included', () => {
      expect(nodesOf(TREE)).toHaveLength(11);
      expect(nodesOf({ kind: 'text', text: 'x' })).toEqual([{ kind: 'text', text: 'x' }]);
    });

    it('lists the event of every control, in the order of the page', () => {
      expect(eventsOf(TREE).map((event) => `${event.ns}/${event.name}`)).toEqual([
        'inventory/addBatch',
        'batch/submit',
        'batch/edit',
        'batch/edit',
        'batch/edit',
      ]);
    });

    it('lists the field of every `edit` event, and leaves out the events that are not edits', () => {
      expect(editedFieldsOf(TREE)).toEqual(['quantity', 'quantity', 'quantity']);
      expect(editedFieldsOf({ kind: 'button', label: 'Save', event: { ns: 'batch', name: 'submit', payload: {} } })).toEqual([]);
      expect(editedFieldsOf({ kind: 'select', label: 'Food Type', value: '', choices: [{ value: '', label: 'New' }], event: { ns: 'batch', name: 'pickFoodType', payload: {} } })).toEqual([]);
    });

    it('finds a button by its label, and nothing for a label that is not there or for a node that is not a button', () => {
      expect(findButton(TREE, 'Save')?.disabled).toBe(true);
      expect(findButton(TREE, 'Nope')).toBeUndefined();
      expect(findButton(TREE, 'Quantity')).toBeUndefined();
    });
  });

  describe('problemsOf', () => {
    it('finds nothing wrong with a tree of all six kinds of node', () => {
      expect(problemsOf(TREE)).toEqual([]);
    });

    const wrong = (tree: unknown): string[] => problemsOf(tree as RenderTree);

    it('reports a kind of node that is not one of the six', () => {
      expect(wrong({ kind: 'box', layout: 'stack', children: [{ kind: 'image', src: 'x' }] })).toEqual(['image is not a kind of node']);
    });

    it('reports a slot that is not one of the 16', () => {
      expect(wrong({ kind: 'slot', slot: 'sidebar', shown: true })).toEqual(['sidebar is not one of the 16 slots']);
    });

    it('reports a layout and a tone that the tokens have no class for', () => {
      expect(wrong({ kind: 'box', layout: 'grid', children: [] })).toEqual(['layout grid has no class']);
      expect(wrong({ kind: 'text', text: 'x', tone: 'loud' })).toEqual(['tone loud has no class']);
      expect(wrong({ kind: 'box', layout: 'stack', tone: 'loud', children: [] })).toEqual(['tone loud has no class']);
      expect(wrong({ kind: 'button', label: 'x', tone: 'loud', event: OK_EVENT })).toEqual(['tone loud has no class']);
    });

    it('reports an event of a namespace that does not exist, and an event that its namespace does not have', () => {
      expect(wrong({ kind: 'button', label: 'x', event: { ns: 'sidebar', name: 'open', payload: {} } })).toEqual(['sidebar is not a namespace']);
      expect(wrong({ kind: 'button', label: 'x', event: { ns: 'shell', name: 'submit', payload: {} } })).toEqual(['shell/submit is not an event of shell']);
      expect(wrong({ kind: 'input', label: 'x', value: '', event: { ns: 'batch', name: 'dance', payload: {} } })).toEqual(['batch/dance is not an event of batch']);
    });

    it('reports a button without a label', () => {
      expect(wrong({ kind: 'button', label: '  ', event: OK_EVENT })).toEqual(['a button has no label']);
    });

    it('reports a select whose value is not one of its choices', () => {
      expect(wrong({ kind: 'select', label: 'Unit', value: 'cups', choices: [{ value: 'ml', label: 'ml' }], event: OK_EVENT })).toEqual([
        'select Unit holds "cups", which is not one of its choices',
      ]);
      expect(wrong({ kind: 'select', label: 'Unit', value: '', choices: [], event: OK_EVENT })).toHaveLength(1);
    });

    it('reports every problem of a tree, wherever it is', () => {
      const tree = { kind: 'box', layout: 'stack', children: [{ kind: 'slot', slot: 'sidebar', shown: true }, { kind: 'button', label: '', event: OK_EVENT }] };

      expect(wrong(tree)).toEqual(['sidebar is not one of the 16 slots', 'a button has no label']);
    });
  });
});
