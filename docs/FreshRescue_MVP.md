# FreshRescue — MVP v1.3 Core Data Flow and Boundary Specification

# 1. Product Overview & Core Assumptions

FreshRescue is a smart refrigerator inventory and recipe management assistant designed to minimize household food waste by tracking batch-level shelf life, letting users view and edit the food inventory, showing dynamic on-screen near-expiry alerts, recommending expiry-first recipes, and automating First-Expired, First-Out (FEFO) inventory deduction when a recipe is cooked.

## 1.1 Core System Assumptions & Explicit Exclusions

* **No Hardware Integration:** MVP v1.3 is a pure software demo. **Cook & Deduct** only updates inventory records. There is no dispenser, so hardware faults (jams, timeouts, mechanical rollback) are out of scope. This specification does not use the words "deliver" or "dispense": the operation is always **deduct**.
* **Manual Input Entry Only:** All food inbound, outbound, and recipe authoring operations are performed via structured manual UI entry. Barcode/OCR scanning and bulk batch editing are explicitly excluded.
* **Single-Source Self-Contained Specification:** This MVP v1.3 specification consolidates all foundational inventory, alert, recipe matching, FEFO deduction, custom category CRUD, custom recipe CRUD, custom freshness threshold, Food Type management, and sequential meal queuing rules into a single unified baseline. 
* **Persistence:** All state (inventory, categories, Food Types, recipes, thresholds, Simulated Today) survives a page reload. The storage mechanism is an implementation choice (for example, browser localStorage). The app is single-user, with no accounts or sync. The cook queue (§4.5) is transient and is not persisted.
* **Recipes Are Ingredient Lists:** A recipe consists of a name, a cuisine category, and its ingredients. Preparation steps, servings, images, and notes are not part of the MVP.
* **On-Screen Alerts Only:** Alerts are shown inside the app. Push, email, and browser notifications are excluded.
* **Other Exclusions:** Automatic unit conversion (for example, kg ↔ grams); undo and cook history; restoring deleted categories, Food Types, or recipes.

## 1.2 Terminology & Entity Model

| Term | Definition |
| :---- | :---- |
| **Food Type** | A registered food definition: name, category, unit, and optional custom threshold. Called an **ingredient** when a recipe or an availability calculation refers to it. In v1.2, "food", "food name", "food type", and "ingredient" were used interchangeably; all of them mean Food Type. |
| **Batch** | One inbound record of a Food Type: quantity, inbound date `D_in`, expiration date `D_exp`, and a creation sequence number `createdSeq`. A batch has no category or unit of its own; it inherits both from its Food Type. |
| **Food Category** | A grouping for Food Types: two levels (Parent → Child) plus the system category `Other`. A category is never a food and never holds batches directly. |
| **Recipe Cuisine Category** | A single-level tag for recipes plus its own system category `Other` (independent of the food-category `Other`). |
| **Deduct** | Reduce batch quantities in inventory when a recipe is cooked. |
| **Status** | The freshness state of a batch: **Fresh**, **Near-Expiry**, or **Expired** (§4.3.2). |
| **Overall Status** (of a Food Type) | The most urgent status among its batches (Expired > Near-Expiry > Fresh). A Food Type with no batches has no status (§4.7.1). |
| `Q_req` | Quantity of an ingredient that a recipe requires. |
| `Q_avail` | Sum of quantities of a Food Type's **Fresh** and **Near-Expiry** batches (§4.2.3). |
| `Q_near_expiry` | Sum of quantities of a Food Type's **Near-Expiry** batches. |
| **Missing Ingredient** | A recipe ingredient with `Q_avail < Q_req` (this includes `Q_avail = 0`). |
| **Rescued Ingredient** | An *available near-expiry ingredient* of a recipe: `Q_near_expiry > 0` **and** `Q_avail ≥ Q_req`. Cooking the recipe is guaranteed to consume Near-Expiry stock (§4.4.B). |

**Entity model**

| Entity | Fields | Rules |
| :---- | :---- | :---- |
| `FoodCategory` | `id`, `name`, `parentId` (null for top-level), `isSystem`, `customThresholdDays` (optional) | Two levels at most. `Other` is a system, top-level leaf: no children, no custom threshold, cannot be renamed or deleted. |
| `FoodType` | `id`, `name`, `categoryId`, `unit`, `customThresholdDays` (optional) | Assigned to exactly one category: a Parent, a Child, or `Other` (default). `unit` is always set and persists when stock is 0. |
| `Batch` | `id`, `foodTypeId`, `quantity`, `inboundDate`, `expirationDate`, `createdSeq` | `createdSeq` increases monotonically and is never reused. Only `quantity` is editable. |
| `RecipeCategory` | `id`, `name`, `isSystem` | Includes its own `Other`. |
| `Recipe` | `id`, `name`, `recipeCategoryId` | Built-in recipes are not a separate type (§4.4.E). |
| `RecipeIngredient` | `recipeId`, `foodTypeId`, `requiredQuantity`, `requiredUnit`, `deletedFoodTypeName` (set only if the Food Type is deleted) | At most one row per Food Type within a recipe. |
| `Settings` | `simulatedToday` (optional date) | See §3 and §4.3.4. |

Relationships: each `FoodCategory` has many `FoodType`s; each `FoodType` has many `Batch`es; each `RecipeCategory` has many `Recipe`s; each `Recipe` has many `RecipeIngredient` rows; each `RecipeIngredient` references one `FoodType`. All quantities are stored as integer thousandths (value × 1000).

# 2. MVP v1.3 Functional Scope Overview

| Functional Feature | MVP v1.3 Included Capabilities | Explicitly Excluded |
| :---- | :---- | :---- |
| **1. Manual Inbound & Outbound** | Batch-level manual addition (every inbound creates a new batch), whole-batch removal, and quantity editing (also reachable from the Feature 5 Inventory view); preset and user-defined two-level food category hierarchies (Parent → Child) plus system category `Other`; in-place category renaming and deletion with automatic fallback to `Other`; one unit per Food Type, with a mandatory multi-batch conversion modal when the unit changes; decimal quantities up to 3 places; 500,000 cumulative quantity cap per Food Type; past-expiry inbound blocking. | Barcode/OCR scanning; bulk batch editing; automatic unit conversion. |
| **2. Freshness & Alert** | Global 3-day static default Near-Expiry threshold; customizable per-category (Parent or Child) and per-Food-Type thresholds; exact 00:00 next-day Expired state transition; dedicated Near-Expiry Warning Panel (with an Expired section); Simulated Today demo control. | Push, email, and browser notifications. |
| **3. Expiry-First Recipe** | Recommends recipes that help use up near-expiry food. **Every recipe in Feature 3 must contain at least 1 available near-expiry ingredient (food)** (`Q_near_expiry > 0` and `Q_avail ≥ Q_req`); a recipe without one never appears here. Tier 1 (100% Full Match), with automatic degradation to Tier 2 (Partial Matches) when Tier 1 is empty; blocked recipes (unit conflict or deleted Food Type) are not shown; alphabetical sorting (A to Z); each recommendation links to Feature 4 for cooking. | Recipes without an available near-expiry ingredient; executing recipes (Feature 3 is recommend-only). |
| **4. Atomic Cook & Deduct** | **Contains all recipes** (built-in and user-created alike), whether or not they contain a near-expiry ingredient: one A–Z list with a cuisine filter; recipe CRUD (add, edit, delete); preset and user-defined recipe cuisine categories (e.g., Chinese Cuisine, Vietnamese Cuisine, French Cuisine, Other) with rename/delete fallback to `Other`; red highlighting of blocked recipes (unit conflict or deleted Food Type); single-recipe execution and sequential multi-recipe queuing; strict 100% per-ingredient fulfillment rule (no partial deduction of an insufficient ingredient); automated FEFO multi-batch deduction excluding expired batches; execution result summary; instant refresh of all derived views. | Undo and cook history. |
| **5. Inventory View & Edit** | **View:** a list of all Food Types (including those with no stock), each showing its total quantity and status (Fresh, Near-Expiry, Expired). **Select a Food Type** to see its batches and perform CRUD: add a batch (create); view its details and batches, each with quantity and status (read); edit a batch's quantity, or the Food Type's name, category, unit, and threshold (update); remove a batch, or delete the Food Type when it has no batches (delete). A Food Type can also be added without stock. All validation comes from §3 and Feature 1. | Bulk batch editing; editing a batch's expiration date (remove the batch and add a new one instead). |

# 3. Input Data Dictionary & Validation Boundaries

All user inputs across food inbound, category management, Food Type management, and recipe authoring must pass strict validation before modifying system state:

| Entity / Field | Format & Constraint Rules | Validation & Boundary Handling |
| :---- | :---- | :---- |
| **Food Type Name, Recipe Name, Category Name** | Text string, trimmed of leading and trailing whitespace, case-insensitive matching. Length: **1 to 200 characters** (after trimming). | Block submission if empty, whitespace-only, longer than 200 characters, or duplicating an existing name **within its uniqueness scope** (listed below). When renaming, the record itself is excluded from the check (`milk` → `Milk` is allowed). |
| **Food Category Hierarchy** | Two levels: **Parent** → **Child** (for example `Meat → Red Meat`, `Meat → Poultry`, `Dairy → Liquid Dairy`, `Vegetables → Leafy Greens`) plus the top-level system category `Other`. A Food Type (for example `Beef`, `Chicken`, `Milk`) is assigned to exactly one category: a Parent, a Child, or `Other`. | Defaults to `Other` if left unselected. The category belongs to the **Food Type**, never to a batch: when adding a batch to an existing Food Type, the category is shown read-only and is changed only by editing the Food Type. `Other` cannot be renamed, deleted, given children, or given a custom threshold. A Child cannot have children. |
| **Recipe Cuisine Category** | Single-level category tag (for example `Chinese Cuisine`, `Vietnamese Cuisine`, `French Cuisine`) plus the system category `Other`, which is separate from the food-category `Other`. | Defaults to `Other` if left unselected. The system-protected `Other` category cannot be renamed or deleted. |
| **Quantity** (batch quantity and recipe `Q_req`) | Positive decimal with **at most 3 digits after the decimal point**; minimum `0.001`. Plain decimal notation only (digits and a single `.`; no sign, no scientific notation, no thousands separators). Stored and computed as integer thousandths to avoid floating-point drift. The same rule applies to inventory and recipes. | Block zero, negative, non-numeric, or more-than-3-decimal input (never round silently). Recipe `Q_req` must satisfy `0.001 ≤ Q_req ≤ 500,000`. |
| **Cumulative Ingredient Quantity Cap** | For each Food Type, the sum of all its batches' quantities (Fresh, Near-Expiry, **and Expired**) must be **at most 500,000**, regardless of unit. | Evaluate the **post-change** total and block the operation if it exceeds 500,000. *Inbound:* existing sum + new quantity. *Batch quantity edit:* existing sum − the edited batch's old quantity + its new quantity. *Unit change:* sum of the new quantities entered in the conversion modal. |
| **Measurement Unit** | One unit per Food Type, chosen from a fixed list: `grams`, `kg`, `ml`, `liters`, `pieces`, `cartons`. The unit belongs to the Food Type and persists even when it has no batches. Units match by exact equality; there is no conversion (`kg` ≠ `grams`). | **Inbound Lock:** whenever the Food Type exists (with or without stock), the inbound form shows its unit read-only; the user picks a unit only when the inbound creates a new Food Type. **Unit Change:** made by editing the Food Type. With no batches the change is immediate; with one or more batches (including Expired) a mandatory modal requires an updated quantity for **every** batch before saving (§4.2.2). |
| **Inbound Shelf Life / Expiration Date** | `D_in` is always the current date `D_now` and is not editable. The user enters either a shelf life in whole days (`S ≥ 0`) or an expiration date on or after today (`D_exp ≥ D_now`). The two are equivalent: `D_exp = D_in + S`, so `S = 0` means "expires today". | **Past-Expiry Block:** the system strictly blocks any manual inbound entry whose expiration date has already passed (`D_exp < D_now`). |
| **Custom Near-Expiry Threshold (`T_warn`)** | Positive integer in days (`T_warn ≥ 1`), configurable on a Parent Category, a Child Category, or an individual Food Type (not on `Other`). Can be cleared, which reverts to inheritance. | Defaults to the global static threshold of **3 days** (not editable). Zero, negative, or non-integer values are blocked. |
| **Recipe Definition** | Requires a Recipe Name (1–200 chars), Cuisine Category (defaults to `Other`), and at least 1 ingredient row. Each row has a Food Type chosen from the existing Food Types, `Q_req` (`0.001 ≤ Q_req ≤ 500,000`, up to 3 decimals), and a Required Unit (from the unit list; defaults to the Food Type's current unit). | Block creation or update if the recipe has 0 ingredients, two rows for the same Food Type, or an invalid quantity. A Required Unit that differs from the Food Type's unit is allowed, but makes the recipe a **Unit Conflict** (§4.4.A). |
| **Simulated Today** (demo control) | Optional calendar date. When set, it replaces the device's current date everywhere this specification uses `D_now` (including `D_in` of new batches and the Past-Expiry Block). | Any valid date is accepted. Clearing it returns to the device date. Changing it immediately re-evaluates all derived views (§4.6). |

**Name uniqueness scopes** (case-insensitive, after trimming):

* **Food Type names** are unique among all Food Types.
* **Recipe names** are unique among all recipes, across cuisines.
* **Food Category names** are unique across both levels (a Parent and a Child cannot share a name). The name `Other` is reserved.
* **Recipe Cuisine Category names** are unique among cuisine categories. `Other` is reserved.
* The four scopes are independent of one another (for example, a Food Type may share a name with a category).
* **Inbound exception:** in the inbound form, a Food Name that matches an existing Food Type is *not* a duplicate error; it selects that Food Type (§4.2.5).

# 4. Core Business Rules & State Transitions

## 4.1 Category Management & Deletion Cascade Rules

1. **Creation:** Users can create Parent food categories, Child food categories under an existing Parent (not under `Other` and not under another Child; two levels only), and Recipe cuisine categories (1–200 characters, unique per §3).
2. **Renaming (In-Place Edit):** Editing a category renames its display label. Renaming updates the name globally across the UI without altering the bindings or state of any Food Types, batches, or recipes. `Other` (food and cuisine) cannot be renamed or deleted.
3. **Deletion & Automatic Fallback to `Other`:**
   * **Deleting a Child Food Category (e.g., `Meat → Red Meat`):** All Food Types assigned to it fall back to the top-level `Other` category. Their batches follow automatically, because a batch inherits its category from its Food Type.
   * **Deleting a Parent Food Category (e.g., `Meat`):** All of its Child categories are deleted, and all Food Types assigned to the Parent or to any of its Children fall back to `Other`.
   * **Deleting a Recipe Cuisine Category (e.g., `French Cuisine`):** All recipes assigned to it fall back to `Other`.
4. **Thresholds on Deletion:** A deleted category's custom threshold is deleted with it (deleting a Parent also deletes its Children's thresholds). Affected Food Types re-derive their effective threshold (§4.3.1), and freshness states are re-evaluated immediately (§4.6).
5. **Category Thresholds:** Custom thresholds can be set on Parent and Child categories (not on `Other`) and can be cleared, which reverts to inheritance (§4.3.1).

## 4.2 Batches, Units & Food Types

### 4.2.1 Batch Independence Under a Single Food Type

* Every inbound creates a **new batch**. Batches are never merged, even when the Food Type, inbound date, and expiration date are all identical. All batches of one Food Type are displayed together under that Food Type and its category.
* A batch's only editable field is its quantity (§4.2.4). To correct a wrong expiration date, remove the batch and add a new one.
* Each batch is displayed with text **computed** from `D_exp − D_now` (never stored): `{quantity} {unit} of {Food Type} — expires in N days`. The wording is `expires in 1 day` when N = 1, `expires today` when N = 0, and `expired N day(s) ago` when N < 0.
* *Worked Example:* On Oct 1 a user adds `500 ml` of Milk with a 5-day shelf life (`D_exp` = Oct 6), and on Oct 2 adds `1000 ml` of Milk with a 10-day shelf life (`D_exp` = Oct 12). Both are grouped under `Dairy → Liquid Dairy → Milk` as two distinct entries. On Oct 2 they read:
  * `500 ml of Milk — expires in 4 days`
  * `1000 ml of Milk — expires in 10 days`

  (On Oct 1 the first entry read "expires in 5 days"; the text changes every day.)

### 4.2.2 Unified Unit Enforcement & Multi-Batch Conversion Flow

1. A Food Type has exactly **one** unit at any time (for example `pieces` or `grams`, never mixed), including while it has no batches. The unit belongs to the Food Type, is chosen from the fixed unit list (§3), and persists after all batches are removed.
2. **Inbound Lock:** Whenever a Food Type exists, with or without stock, the inbound form shows its unit read-only. If the refrigerator holds `300 grams` of `Chicken`, the next inbound of `Chicken` is in `grams`. The user chooses a unit only when the inbound creates a new Food Type (§4.2.5).
3. **Changing a Unit (Food Type edit):**
   * With no batches, the unit changes immediately.
   * With one or more batches (Fresh, Near-Expiry, **and Expired**), a single modal lists every batch and requires its updated quantity in the new unit. Saving is disabled until every field is valid. On confirm, the sum of the new quantities is checked against the 500,000 cap (§3). If valid, all batches update atomically; otherwise nothing changes. Cancel changes nothing. Expiration dates and `createdSeq` are untouched. Users are assumed to enter accurate physical counts.
   * *Worked Example:* `Chicken` has Batch 1 (`100 grams`) and Batch 2 (`200 grams`). The user changes the unit of `Chicken` from `grams` to `pieces`. The modal asks for both batches in `pieces` (say `0.5` and `1`). After confirmation, both batches are in `pieces`.
4. After a unit change, every recipe whose Required Unit differs from the new unit becomes a Unit Conflict (§4.4.A) automatically. Recipes are never rewritten automatically.

### 4.2.3 Effective Available Inventory (`Q_avail`) Calculation

* For any ingredient, `Q_avail` is the sum of quantities across all **Fresh** and **Near-Expiry** batches only. `Q_near_expiry` is the sum across its **Near-Expiry** batches only.
* **Expired** batches remain visible in the inventory list so the user knows to physically discard and manually remove them, and they continue to count toward the 500,000 cap until removed, but they contribute **0** to `Q_avail` and `Q_near_expiry`.

### 4.2.4 Batch Outbound vs. Food Type Deletion

1. **Manual Batch Outbound** has two forms. **Remove batch** deletes one whole batch. **Edit quantity** replaces a batch's quantity with a new positive value; this is how a partial outbound is recorded. A quantity cannot be edited to 0; use Remove instead.
2. **Depletion:** Removing all batches of a Food Type sets its `Q_avail = 0` while keeping the Food Type registered, with its unit, category, and threshold intact.
3. **Deleting a Food Type** is allowed **only when it has zero batches** (Fresh, Near-Expiry, or Expired). Otherwise the deletion is blocked with "Remove all N batches first." A confirmation lists the recipes that will become blocked. Deleting a Food Type also deletes its custom threshold.
4. **Deleting a Food Type Referenced by a Recipe:** Each referencing recipe keeps its ingredient row, stores the deleted name in `deletedFoodTypeName`, remains visible in Feature 4 **highlighted in red** with the message "Missing food type: {name}", and is blocked from processing (§4.4.A). The user can edit the recipe (select a different Food Type for the row) or delete it. References are by ID: re-creating a Food Type with the same name does **not** repair existing recipes.

### 4.2.5 Food Type Lifecycle

1. **Creation Paths:**
   * **Pre-loaded:** Food Types that the pre-loaded (built-in) recipes reference are loaded together with those recipes (§4.4.E). To the application they are ordinary Food Types.
   * **Inbound form:** if the entered name (trimmed, case-insensitive) matches no existing Food Type, a new Food Type is created together with its first batch. The user chooses the category (default `Other`) and the unit (required). The Food Type and the batch are created together or not at all.
   * **Inventory view (Feature 5, §4.7):** the **Add Food Type** action creates a Food Type without a batch (name, category defaulting to `Other`, unit required), so recipes can be authored before the food is bought.
2. **Inbound Name Matching:** If the entered name matches an existing Food Type (case-insensitive), it is **selected**, not rejected as a duplicate. The batch joins that Food Type, and its unit and category are shown read-only (§3, §4.2.2).
3. **Edit:** name (same validation; the record itself is excluded from the duplicate check), category, unit (§4.2.2), and custom threshold (set or clear). A category or threshold change immediately re-derives `T_eff` for all of its batches (§4.6). Editing is performed from the Food Type detail (§4.7.2).
4. **Delete:** see §4.2.4. Deleting is performed from the Food Type detail (§4.7.2).

## 4.3 Freshness Lifecycle & Alert State Machine (Feature 2)

Let `D_in` be the calendar date the batch was added (always `D_now` at inbound), `S` the shelf-life duration in days (`S ≥ 0`), `D_exp = D_in + S` the expiration date, and `D_now` the current calendar date (§4.3.4). `D_exp` is the **last day the item is usable**. *Days left* = `D_exp − D_now`.

### 4.3.1 Effective Near-Expiry Threshold (`T_eff`) Precedence

The first threshold that is set wins:

* **Priority 1:** Food Type custom threshold.
* **Priority 2:** Child Category custom threshold (only if the Food Type is assigned to a Child).
* **Priority 3:** Parent Category custom threshold (the assigned Parent, or the Parent of the assigned Child).
* **Priority 4:** Global static default threshold (**3 days**).

Food Types in `Other` use Priority 1 or 4 only. All batches of a Food Type share the same `T_eff`.

### 4.3.2 Lifecycle States

* **Fresh State (`D_exp − D_now > T_eff`):** Normal inventory display; no warning issued.
* **Near-Expiry State (`0 ≤ D_exp − D_now ≤ T_eff`):** Item is displayed in the dedicated **Near-Expiry Warning Panel** with a warning badge, and qualifies as a trigger for Feature 3 (Expiry-First Recipe).
* **Expired State (`D_exp − D_now < 0`; triggered at `00:00:00` on `D_exp + 1 day`):** Item is flagged with a red Expired badge and is strictly excluded from `Q_avail`, all recipe recommendations, and all deductions.
* *Worked Example:* A user adds an item on **Oct 1, 2026** with a shelf life of **3 days** (`D_exp = Oct 4, 2026`) and the default `T_eff` of 3 days. The item is Near-Expiry from the moment it is added (days left = 3 ≤ 3), stays Near-Expiry through Oct 4 (usable all day), and is marked **Expired at exactly 00:00 on Oct 5, 2026**. Any batch with `S ≤ T_eff` is Near-Expiry at inbound.

### 4.3.3 Alert Surfaces & Ordering

* **Near-Expiry Warning Panel:** lists Near-Expiry batches with a warning badge, plus a separate **Expired** section listing Expired batches with a red badge. Each section is sorted by days left ascending, then Food Type name A to Z, then `createdSeq`.
* **Inventory list and Food Type detail:** defined in §4.7 (Feature 5).
* Empty states are defined in §4.6.

### 4.3.4 Time Handling & Simulated Today

* `D_now` is the local calendar date of the user's device, unless Simulated Today is set (§3).
* Freshness states are derived (§4.6): they are evaluated at render time and **re-evaluated when the user confirms Cook & Deduct**, so a cook that crosses midnight uses current states.
* While the app is open, it refreshes at the next local `00:00` so the panels update without a reload.
* Because inbound blocks past expiration dates, Expired batches can only appear as time passes. **Simulated Today** lets a demo or test advance `D_now`. For example, add a batch with a 2-day shelf life, then set Simulated Today three days ahead: the batch is Expired.

## 4.4 Dual Recipe Views & Error Blocking (Feature 3 vs. Feature 4)

### 4.4.A Global Recipe Error Validation

A recipe is marked in **Red**, displays a diagnostic message naming each affected ingredient row, and has its **Cook & Deduct action disabled** if either of the following errors exists:

1. **Missing Food Type Error:** An ingredient row references a Food Type that has been deleted (§4.2.4).
2. **Unit Conflict Error:** The ingredient's Required Unit differs from the Food Type's unit (e.g., the recipe requires `300 grams` of `Chicken`, but `Chicken` is held in `pieces`). The check compares against the Food Type's unit regardless of current stock.

A recipe can show both errors. For an affected ingredient `Q_avail` cannot be evaluated, so a Blocked Error recipe is never classified as Full Match or Partial Match. Blocked recipes are shown in red in Feature 4 and are hidden from Feature 3.

### 4.4.B Feature 3: Expiry-First Recipe Recommendation Engine

Feature 3 is dedicated to helping users consume Near-Expiry items before they spoil.

1. **Mandatory Near-Expiry Entry Gate:** A recipe can appear in Feature 3 **only if** (a) it is not a Blocked Error recipe, and (b) it contains at least one **Rescued Ingredient**, i.e. an available near-expiry ingredient (`Q_near_expiry > 0` and `Q_avail ≥ Q_req`). In other words, every recipe shown in Feature 3 contains at least 1 available near-expiry food. Recipes that use only Fresh or Missing items, or whose Near-Expiry ingredient is itself short of stock, never appear in Feature 3. Because all batches of a Food Type share the same `T_eff`, FEFO always consumes Near-Expiry batches before Fresh ones, so a Rescued Ingredient is guaranteed to consume Near-Expiry stock when the recipe is cooked.
2. **Primary Display: Tier 1 (100% Full Match):** Gated recipes where **every** required ingredient satisfies `Q_avail ≥ Q_req` (combining non-expired Near-Expiry and Fresh batches as needed), sorted **alphabetically (A to Z)** by recipe name.
3. **Degradation Display: Tier 2 (Partial Matches):** Shown **only when Tier 1 yields 0 recipes** while Near-Expiry items exist. Displays gated recipes that have at least one Missing Ingredient (`Q_avail < Q_req`). Each Missing Ingredient is explicitly badged. Sorted **alphabetically (A to Z)** by recipe name.
4. **Recommend-Only:** Feature 3 has no Cook controls. Each recommended recipe has an "Open in Cook" link to its entry in Feature 4, where status, queuing, and execution happen (§4.5).
5. **Empty States:** see §4.6.

### 4.4.C Feature 4: Atomic Cook & Deduct Full Catalog View

1. **All-Recipe Visibility:** Feature 4 displays **all recipes** in the system (both built-in and user-created) as one list sorted **alphabetically (A to Z)** by recipe name, with an optional single-select cuisine-category filter (default: All), regardless of whether a recipe contains a Near-Expiry item.
2. **Status Indicators:** Each recipe displays its real-time status:
   * **Full Match:** All ingredients meet `Q_avail ≥ Q_req`.
   * **Partial Match:** One or more ingredients have `Q_avail < Q_req` (each badged **Missing**), with a count such as "2 of 3 ingredients available". If no ingredient is available, the recipe's Cook action is disabled with the note "Nothing available to deduct".
   * **Blocked Error (Highlighted in Red):** Unit conflict or missing Food Type (cannot be processed).

### 4.4.D Sorting Rule

"A to Z" means a case-insensitive, locale-aware comparison of the trimmed name; ties are broken by creation order. It applies to Tier 1, Tier 2, Feature 4, and the Feature 5 Inventory list.

### 4.4.E Built-in Recipes

A built-in recipe is exactly the same as a user-created recipe: same fields, same validation (§3), same edit and delete rights, same error states, and same execution rules. The only difference is that built-in recipes are pre-loaded into the system after development, so users find them there from the start. There is no built-in flag and no special behavior.

Pre-loading is equivalent to a user creating the same Food Types and recipes through the normal screens, so pre-loaded data must satisfy the same rules: each ingredient references an existing Food Type and uses that Food Type's unit (otherwise the recipe would show as a Blocked Error). The content of the built-in library is outside this specification; Appendix A is a non-normative sample.

## 4.5 Atomic Cook, Sequential Meal Queuing & FEFO Deduction Engine (Feature 4 Execution)

Cook & Deduct exists **only in Feature 4**. The Cook action is disabled for Blocked Error recipes and for recipes with no available ingredient (§4.4.C).

**"Atomic" defined:** a single recipe's deductions are applied as one unit: they all commit together, or none do. It does **not** mean that every ingredient must be fulfilled; Missing Ingredients are skipped (0 deducted) per rule 2.

1. **Single-Recipe Execution & Sequential Multi-Recipe Queuing:**
   * Cook & Deduct on one recipe is one atomic inventory transaction. States are evaluated at the moment the user confirms (§4.3.4), not when the screen was rendered.
   * Users can add recipes to a **queue**. The order is the order of addition; entries can be removed or moved up or down before running. The same recipe may be queued more than once (each entry is a separate execution). Deleting a recipe removes its queue entries. The queue is transient and not persisted.
   * The queue runs **strictly one recipe at a time, in order**. Each recipe commits as its own atomic transaction before the next is evaluated; `Q_avail` is recomputed after each one, and the next recipe is evaluated against the newly remaining inventory. There is no whole-queue rollback.
   * At its turn, a queued recipe is skipped with a message if it is a Blocked Error recipe or has no available ingredient; the queue then continues.
2. **Strict 100% Per-Ingredient Fulfillment Rule (No Partial Ingredient Deduction):**
   * Each required ingredient is evaluated independently:
   * **100% Available (`Q_avail ≥ Q_req`):** The system deducts exactly `Q_req` from inventory.
   * **Insufficient Stock (`0 ≤ Q_avail < Q_req`, a "Missing Ingredient"):** If an ingredient does not have the full 100% required non-expired amount, it is treated as a Missing Ingredient and **0 quantity is deducted**; its stock is left untouched.
   * *Worked Example:* If a Partial Match recipe requires `300g Beef` and `200g Broccoli`, and the refrigerator holds `150g Beef` and `250g Broccoli`, processing the recipe deducts `200g Broccoli` (leaving `50g Broccoli`), but deducts **0g Beef** (leaving the `150g Beef` untouched because `150g < 300g`).
3. **FEFO (First-Expired, First-Out) Multi-Batch Deduction Rule:** For every ingredient that satisfies `Q_avail ≥ Q_req`, the system deducts `Q_req` across batches as follows:
   * **Step 1 (Exclude Expired):** Completely ignore all **Expired** batches.
   * **Step 2 (Order by Earliest Expiry):** Sort all remaining **Near-Expiry** and **Fresh** batches of that ingredient by `D_exp` ascending. If two batches share the same `D_exp`, the one with the lower `createdSeq` (created earlier) goes first.
   * **Step 3 (Sequential Batch Deduction):** Deduct from the earliest-expiring batch first, carrying any remaining required amount over to the next batch.
   * *Worked Example:* A recipe requires `300g Beef`. The refrigerator holds:
     * **Batch A:** `100g Beef` (Expired yesterday)
     * **Batch B:** `150g Beef` (Near-Expiry, expiring tomorrow)
     * **Batch C:** `200g Beef` (Fresh, expiring in 7 days)
     * **Execution Result:** Batch A (`100g`) is excluded and untouched. Batch B (`150g`) and Batch C (`200g`) provide `Q_avail = 350g ≥ 300g`. Upon cooking, the system consumes all `150g` from Batch B (removing Batch B from active inventory) and `150g` from Batch C (leaving `50g` in Batch C).
4. **Execution Result Summary:** After every Cook & Deduct (single or queued), the UI shows, per recipe, the ingredients deducted (quantity and unit), the ingredients skipped as Missing (needed vs. available), or "Nothing to deduct — skipped".
5. **Post-Cook Cascade Refresh:** Any batch whose quantity reaches `0` is automatically removed from the inventory display, and all derived views refresh immediately (§4.6).

## 4.6 Derived Views, Refresh & Empty States

The following are **derived** from stored state and are never stored themselves: freshness states, `T_eff`, `Q_avail`, `Q_near_expiry`, the Near-Expiry Warning Panel, Feature 3 tiers, Feature 4 statuses, the Feature 5 quantities and statuses, and recipe error states. They are recomputed immediately after **any** state change: inbound; batch edit or removal; Food Type create, edit, or delete; unit change; category create, rename, or delete; threshold set or clear; recipe create, edit, or delete; Cook & Deduct; Simulated Today change; and the midnight rollover.

**Empty states**

| Situation | Feature 2 (Warning Panel) | Feature 3 (Expiry-First) | Feature 4 (Catalog) |
| :---- | :---- | :---- | :---- |
| No Near-Expiry batches | "No near-expiry items" (the Expired section appears only if Expired batches exist) | "No near-expiry items — no rescue recipes are needed" | Fully available |
| Near-Expiry batches exist, but no recipe has a Rescued Ingredient (Tier 1 and Tier 2 both empty) | Lists the Near-Expiry batches | "No recipe can rescue your near-expiry items yet" | Fully available |
| Near-Expiry batches exist and Tier 1 is not empty | Lists the Near-Expiry batches | Tier 1 list | Fully available |
| Near-Expiry batches exist, Tier 1 is empty, Tier 2 is not empty | Lists the Near-Expiry batches | Tier 2 list ("Partial Matches") | Fully available |

## 4.7 Inventory View & Edit (Feature 5)

Feature 5 is the one place to see everything in the refrigerator and to change it. It adds no new data rules: every create, update, and delete below uses the validation of §3 and the behavior of §4.2.

### 4.7.1 Inventory List (View All Food Types)

* The list shows **all** Food Types, including those with no batches (a Food Type stays registered after its last batch is removed, §4.2.4).
* Each row shows:
  * the **Food Type name** and its category path (for example `Meat → Poultry`, or `Other`);
  * the **total quantity** with its unit: the sum of all of its batches (Fresh, Near-Expiry, and Expired), i.e. the physical stock that also counts toward the 500,000 cap (§3). The part recipes can use is `Q_avail` (Fresh + Near-Expiry, §4.2.3);
  * the **status**: a quantity breakdown by status, for example `Fresh 300 · Near-Expiry 150 · Expired 100` (statuses with quantity 0 are omitted), and an **overall status** badge, which is the most urgent status present (Expired > Near-Expiry > Fresh).
* A Food Type with no batches shows quantity `0` and no status ("—").
* Rows are sorted A to Z by Food Type name (§4.4.D).
* Selecting a row opens the Food Type detail (§4.7.2). An **Add Food Type** action creates a Food Type without a batch (§4.2.5), and the inbound form of Feature 1 is also reachable from this view.
* If no Food Type exists, the list shows "No food yet" together with the two actions above.

### 4.7.2 Food Type Detail (Select a Food Type and Perform CRUD)

* **Read:** The header shows the Food Type's name, category path, unit, total quantity, the status breakdown of §4.7.1, and its effective Near-Expiry threshold (`T_eff`) with its source (Food Type, Child category, Parent category, or global default, §4.3.1). Below it, every batch is listed (Fresh, Near-Expiry, and Expired) with its quantity and unit, inbound date `D_in`, expiration date `D_exp`, the computed text of §4.2.1, and a **status** badge (§4.3.2). Batches are sorted by `D_exp` ascending, then `createdSeq`. A Food Type with no batches shows "No batches".
* **Create:** **Add batch** opens the inbound form with this Food Type pre-selected. The user enters the quantity and either the shelf life or the expiration date; the unit and category are shown read-only (§4.2.2). The Past-Expiry Block, the quantity format, and the 500,000 cap apply (§3). Each Create makes a new batch (§4.2.1).
* **Update:**
  * *Batch:* edit its **quantity**, the only editable batch field (§4.2.1). The quantity format and the post-change cap apply; a quantity cannot be edited to 0 (use Delete).
  * *Food Type:* edit its name, category, unit, and custom threshold (§4.2.5). Changing the unit follows the conversion flow of §4.2.2, including Expired batches.
* **Delete:**
  * *Batch:* **Remove batch** deletes one whole batch (manual outbound, §4.2.4). Removing the last batch leaves the Food Type registered with quantity `0`.
  * *Food Type:* allowed only when it has no batches; a confirmation lists the recipes that will become blocked (§4.2.4).
* Every create, update, and delete refreshes all derived views immediately: this list, the Near-Expiry Warning Panel, Feature 3, and Feature 4 (§4.6).

# 5. Complete Exception & Degradation Matrix

| # | Exception / Boundary Scenario | System Behavior & UI Response | Outcome |
| :---- | :---- | :---- | :---- |
| **1** | **Manual Inbound Expiration Date in the Past (`D_exp < D_now`)** | Reject form submission; highlight the expiration field and prompt the user to enter a shelf life of 0 or more days, or a date on or after today. | Inbound Blocked |
| **2** | **Ingredient Cumulative Total Would Exceed 500,000** | Reject any inbound, batch edit, or unit change whose post-change total (§3) exceeds 500,000. | Inbound / Edit / Unit Change Blocked |
| **3** | **Name > 200 Chars, Empty, or Duplicate; Quantity ≤ 0, Non-Numeric, or > 3 Decimals** | Reject submission and display a validation message (1–200 characters, uniqueness within scope, or the quantity format). | Submission Blocked |
| **4** | **Adding a New Batch to an Existing Food Type** | Show the Food Type's unit and category read-only (inherited). | Enforced in UI |
| **5** | **User Changes the Unit of a Food Type That Has Batches** | Display a mandatory modal listing every batch (including Expired) and requiring an updated quantity for each before saving; Cancel changes nothing. | Atomic Commit on Confirm |
| **6** | **Recipe Unit Conflicts with Food Type Unit** | Highlight the recipe card and the conflicting ingredient row in **Red** in Feature 4; hide the recipe from Feature 3; prompt the user to fix the recipe or the Food Type unit. | **Blocked (Cannot cook)** |
| **7** | **User Deletes a Food Type Referenced by a Recipe** | Allowed only when the Food Type has no batches (see #15). Each referencing recipe stays visible in Feature 4, highlighted in **Red** with "Missing food type: {name}", and is hidden from Feature 3; the user can edit or delete the recipe. | **Blocked (Cannot cook)** |
| **8** | **User Renames a Food or Recipe Category** | Update the category display name in place; all associated Food Types, batches, and recipes remain bound. | Allowed |
| **9** | **User Deletes a Food or Recipe Category** | Reassign all Food Types (including those under child categories) or recipes under the deleted category to the system `Other`. The deleted category's custom threshold is removed, and affected Food Types re-derive `T_eff`. | Allowed |
| **10** | **Ingredient Has Insufficient Stock (`0 ≤ Q_avail < Q_req`)** | Badge the ingredient as a **Missing Ingredient** on the recipe card. If the recipe is cooked, deduct **0** of this ingredient (only ingredients where `Q_avail ≥ Q_req` are deducted). | **Allowed (deducts only 100%-fulfilled ingredients)** |
| **11** | **Zero 100% Full-Match Recipes in Feature 3** | Automatically degrade Feature 3 to **Partial Matches**, showing gated recipes (§4.4.B) that have at least one Missing Ingredient, sorted A to Z. | **Shown (execute in Feature 4)** |
| **12** | **Recipe Contains No Rescued Ingredient** | Exclude the recipe from **Feature 3**, but keep it visible and executable in **Feature 4**. | **Allowed in Feature 4 Only** |
| **13** | **Zero Near-Expiry Items in the Entire Refrigerator** | Feature 2 displays "No near-expiry items"; Feature 3 displays an empty state indicating no rescue recipes are needed; Feature 4 remains fully available for normal cooking. | **Allowed via Feature 4** |
| **14** | **Queued Multi-Recipe Execution Depletes a Shared Ingredient** | Recipe 1 consumes the shared ingredient first. When Recipe 2 runs next in sequence, the depleted ingredient is evaluated as `Q_avail < Q_req` (Missing) and 0 of it is deducted, while Recipe 2's remaining 100%-fulfilled ingredients are deducted normally. | **Allowed (Degraded Sequentially)** |
| **15** | **Delete a Food Type That Still Has Batches (Fresh, Near-Expiry, or Expired)** | Block the deletion with "Remove all N batches first." | Delete Blocked |
| **16** | **Recipe Has No Available Ingredient (Every Ingredient Missing)** | In Feature 4, Cook is disabled with "Nothing available to deduct". In a queue, the entry is skipped with the same message and the queue continues. | **Cook Disabled / Skipped** |
| **17** | **Near-Expiry Items Exist but No Recipe Has a Rescued Ingredient** | Feature 3 shows "No recipe can rescue your near-expiry items yet" (not the #13 message); Features 2 and 4 behave normally. | **Allowed via Feature 4** |
| **18** | **Inbound Name Matches an Existing Food Type (Case-Insensitive)** | Not a duplicate error: the batch is added to the existing Food Type, and its unit and category are shown read-only. | Allowed |
| **19** | **User Creates a Category Named `Other`, a Child Under `Other`, or a Child Under a Child** | Reject creation and display a validation message. | Creation Blocked |
| **20** | **Midnight Passes or Simulated Today Changes** | Re-derive all freshness states and dependent views immediately (§4.6). | Allowed |
| **21** | **Queue Edge Cases: Same Recipe Queued Twice; Queued Recipe Is Blocked at Its Turn** | Duplicates are allowed and run independently. A recipe that is Blocked at its turn is skipped with an error message, and the queue continues. | Allowed / Skipped |
| **22** | **Food Type With No Batches in the Inventory List** | Shown with quantity `0` and no status ("—"). It can still be selected to add a batch, edit the Food Type, or delete it (§4.7). | Allowed |
| **23** | **Food Type With Batches in More Than One Status** | The total quantity covers all batches (Fresh, Near-Expiry, and Expired). The status breakdown shows each status's quantity, and the overall status is the most urgent one present (Expired > Near-Expiry > Fresh). | Allowed |

# Appendix A — Sample Pre-Load Data (Non-Normative)

An example of the data the team could pre-load after development (§4.4.E). It is not a requirement and can be replaced or dropped. Like any pre-loaded data, it follows the same rules as user-entered data: every recipe's Required Unit equals its Food Type's unit, so no recipe starts red. In this sample the refrigerator starts empty and no custom thresholds are set. Several Food Types are shared between recipes on purpose, so the queue and shortage rules (§4.5, exception #14) can be demonstrated.

**Preset food categories:** `Meat` (children: `Red Meat`, `Poultry`), `Dairy` (child: `Liquid Dairy`), `Vegetables` (child: `Leafy Greens`), plus the system category `Other`.

**Preset cuisine categories:** `Chinese Cuisine`, `Vietnamese Cuisine`, `French Cuisine`, plus the system category `Other`.

**Sample Food Types**

| Food Type | Category | Unit |
| :---- | :---- | :---- |
| Beef | Meat → Red Meat | grams |
| Broccoli | Vegetables (assigned directly to the Parent) | grams |
| Chicken | Meat → Poultry | grams |
| Egg | Other | pieces |
| Milk | Dairy → Liquid Dairy | ml |
| Rice | Other | grams |
| Spinach | Vegetables → Leafy Greens | grams |
| Tomato | Vegetables | pieces |

**Sample built-in recipes**

| Recipe | Cuisine | Ingredients |
| :---- | :---- | :---- |
| Beef and Broccoli Stir-Fry | Chinese Cuisine | Beef 300 grams; Broccoli 200 grams |
| Chicken Broccoli Gratin | French Cuisine | Chicken 250 grams; Broccoli 150 grams; Milk 100 ml |
| Chicken Fried Rice | Chinese Cuisine | Chicken 200 grams; Rice 300 grams; Egg 2 pieces |
| Spinach Omelette | French Cuisine | Egg 3 pieces; Spinach 50 grams; Milk 50 ml |
| Tomato Egg Stir-Fry | Chinese Cuisine | Tomato 2 pieces; Egg 3 pieces |
| Vietnamese Chicken Rice | Vietnamese Cuisine | Chicken 250 grams; Rice 300 grams |
