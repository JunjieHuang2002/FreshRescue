import type { CategoryScope } from '@freshrescue/contract-rules';
import type { FormState, RenderTree } from '@freshrescue/contract-ui';
import type { CategoryNode, ReferenceDataDto } from '@freshrescue/contract-views';

const days = (count: number): string => `${count} ${count === 1 ? 'day' : 'days'}`;

/** The name of a category of a tree, found by its id, for the title of a form that creates a child. */
const nameOf = (nodes: readonly CategoryNode[], id: string): string => {
  for (const node of nodes) {
    if (String(node.id) === id) return node.name;
    const inside = node.children.find((child) => String(child.id) === id);
    if (inside !== undefined) return inside.name;
  }
  return '';
};

/** One category with its buttons. `Other` is a system category: it cannot be renamed, deleted or given a threshold or a child. */
function rowOf(node: CategoryNode, scope: CategoryScope, depth: 0 | 1): RenderTree {
  const buttons: RenderTree[] = [];
  if (!node.isSystem) {
    buttons.push({
      kind: 'button',
      label: 'Rename',
      tone: 'quiet',
      event: { ns: 'category', name: 'renameCategory', payload: { scope, category: node } },
    });
    if (scope === 'foodCategory') {
      buttons.push({
        kind: 'button',
        label: 'Set threshold',
        tone: 'quiet',
        event: { ns: 'threshold', name: 'setThreshold', payload: { category: node } },
      });
    }
    if (scope === 'foodCategory' && depth === 0) {
      buttons.push({
        kind: 'button',
        label: 'Add child',
        tone: 'quiet',
        event: { ns: 'category', name: 'newCategory', payload: { scope, parent: node } },
      });
    }
    buttons.push({
      kind: 'button',
      label: 'Delete',
      tone: 'remove',
      event: { ns: 'categoryDelete', name: 'deleteCategory', payload: { scope, category: node } },
    });
  }
  const threshold: RenderTree[] =
    scope === 'foodCategory' && !node.isSystem
      ? [{ kind: 'text', text: node.customThresholdDays === null ? 'Threshold: inherited' : `Threshold: ${days(node.customThresholdDays)}`, tone: 'muted' }]
      : [];
  const name: RenderTree = { kind: 'text', text: depth === 1 ? `— ${node.name}` : node.name, ...(node.isSystem ? { icon: 'lock' as const } : {}) };
  return { kind: 'box', layout: 'row', children: [name, ...threshold, ...buttons] };
}

/** A tree as a list: each top-level category, with its children in a branch under it. */
function treeOf(nodes: readonly CategoryNode[], scope: CategoryScope): RenderTree {
  return {
    kind: 'box',
    layout: 'list',
    children: nodes.flatMap((node): RenderTree[] => [
      rowOf(node, scope, 0),
      ...(node.children.length === 0 ? [] : [{ kind: 'box', layout: 'branch', children: node.children.map((child) => rowOf(child, scope, 1)) } as const]),
    ]),
  };
}

/** The heading of a tree with its button, and the tree under it. */
const groupOf = (title: string, add: RenderTree, tree: RenderTree): RenderTree => ({
  kind: 'box',
  layout: 'stack',
  children: [{ kind: 'box', layout: 'header', children: [{ kind: 'text', text: title, tone: 'title' }, add] }, tree],
});

function categoryForm(form: FormState, reference: ReferenceDataDto | null): RenderTree[] {
  const { kind, values, hints } = form.context;
  if (form.value === 'closed' || (kind !== 'categoryCreate' && kind !== 'categoryRename')) return [];
  const submitting = form.value === 'submitting';
  const cuisine = values.scope === 'cuisine';
  const parent = nameOf(reference?.foodCategories ?? [], values.parentId ?? '');
  let title = 'Rename category';
  if (kind === 'categoryCreate') title = parent !== '' ? `New child category of ${parent}` : cuisine ? 'New cuisine' : 'New food category';
  const hint = hints.name;
  return [
    {
      kind: 'box',
      layout: 'editor',
      children: [
        { kind: 'box', layout: 'header', children: [{ kind: 'text', text: title, tone: 'title' }] },
        {
          kind: 'input',
          label: 'Name',
          value: values.name ?? '',
          event: { ns: 'category', name: 'edit', payload: { field: 'name' } },
          ...(hint === undefined ? {} : { hint }),
          disabled: submitting,
        },
        {
          kind: 'box',
          layout: 'actions',
          children: [
            {
              kind: 'button',
              label: submitting ? 'Saving…' : 'Save',
              tone: 'primary',
              event: { ns: 'category', name: 'submit', payload: {} },
              disabled: submitting,
            },
            { kind: 'button', label: 'Cancel', tone: 'quiet', event: { ns: 'category', name: 'cancel', payload: {} }, disabled: submitting },
          ],
        },
      ],
    },
  ];
}

function thresholdForm(form: FormState): RenderTree[] {
  const { kind, values, hints } = form.context;
  if (form.value === 'closed' || kind !== 'thresholdSet') return [];
  const submitting = form.value === 'submitting';
  const hint = hints.thresholdDays;
  return [
    {
      kind: 'box',
      layout: 'editor',
      children: [
        { kind: 'box', layout: 'header', children: [{ kind: 'text', text: `Near-expiry threshold of ${values.name ?? ''}`, tone: 'title' }] },
        {
          kind: 'input',
          label: 'Days',
          value: values.thresholdDays ?? '',
          event: { ns: 'threshold', name: 'edit', payload: { field: 'thresholdDays' } },
          ...(hint === undefined ? {} : { hint }),
          disabled: submitting,
        },
        { kind: 'text', text: 'Leave it empty to inherit the threshold of the Parent category, or the default.', tone: 'muted' },
        {
          kind: 'box',
          layout: 'actions',
          children: [
            {
              kind: 'button',
              label: submitting ? 'Saving…' : 'Save',
              tone: 'primary',
              event: { ns: 'threshold', name: 'submit', payload: {} },
              disabled: submitting,
            },
            { kind: 'button', label: 'Cancel', tone: 'quiet', event: { ns: 'threshold', name: 'cancel', payload: {} }, disabled: submitting },
          ],
        },
      ],
    },
  ];
}

/**
 * FU-16 CategoryManagerView. Draws the two category trees with their controls (blueprint 1.8, spec
 * 4.1): the food categories, with a Parent's children under it, and the recipe cuisines. Each
 * category shows its threshold (food categories only) and buttons to rename it, set its threshold,
 * add a child (a Parent only, because a Child cannot have children) and delete it. `Other` has none
 * of them. The create or rename form and the threshold form of the two slices that feed this view
 * draw above the trees when they are open. The trees come with the reference data.
 */
export function categoryManagerView(category: FormState, threshold: FormState, reference: ReferenceDataDto | null): RenderTree {
  const trees: RenderTree[] =
    reference === null
      ? [{ kind: 'text', text: 'Loading categories…', tone: 'muted' }]
      : [
          {
            kind: 'box',
            layout: 'columns',
            children: [
              groupOf(
                'Food categories',
                {
                  kind: 'button',
                  label: 'Add food category',
                  tone: 'soft',
                  icon: 'plus',
                  event: { ns: 'category', name: 'newCategory', payload: { scope: 'foodCategory', parent: null } },
                },
                treeOf(reference.foodCategories, 'foodCategory'),
              ),
              groupOf(
                'Recipe cuisines',
                {
                  kind: 'button',
                  label: 'Add cuisine',
                  tone: 'soft',
                  icon: 'plus',
                  event: { ns: 'category', name: 'newCategory', payload: { scope: 'cuisine', parent: null } },
                },
                treeOf(reference.cuisines, 'cuisine'),
              ),
            ],
          },
        ];
  return { kind: 'box', layout: 'stack', children: [...categoryForm(category, reference), ...thresholdForm(threshold), ...trees] };
}
