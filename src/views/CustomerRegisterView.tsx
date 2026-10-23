import React, { useState } from 'react';
import { 
  ClipboardList, 
  CheckCircle2, 
  Info, 
  Plus, 
  Trash2, 
  ArrowRight,
  Sparkles,
  AlertTriangle
} from 'lucide-react';
import { cafeConfig } from '../config/cafe.config';
import { Session, ItemCategory, PowerType } from '../types';
import {
  submitRegistration,
  generateReferenceToken,
  getDefaultPowerTypeForCategory,
  getPowerTypeLabel,
  getItemTypeSuggestions,
  resolveItemTypeClassification,
  findExcludedItemMatch,
  formatItemBrandModel,
  ItemTypeSuggestion,
  POWER_TYPE_OPTIONS
} from '../services/repairService';
import { TermsModal } from '../components/common/TermsModal';
import { useRegisterUnsavedWork } from '../context/UnsavedWorkContext';

// Props passed to Station 1 (`CustomerRegisterView`) from the top-level router
interface CustomerRegisterViewProps {
  // Currently active Repair Café session (or null when no session is open)
  session: Session | null;
}

// Local form state for each item being registered by the visitor
interface ItemInputState {
  itemType: string;
  brand: string;
  model: string;
  category: ItemCategory;
  brandModel: string;
  faultDescription: string;
  powerType: PowerType;
}

// Human-readable category badge labels shown in the Item Type autocomplete menu
const CATEGORY_SHORT_LABELS: Record<ItemCategory, string> = {
  ELECTRICAL: 'Electrical',
  MECHANICAL: 'Mechanical',
  TEXTILES: 'Textiles',
  WOODWORK: 'Woodwork',
  TOY: 'Toys',
  OTHER: 'Other'
};

// Creates a blank default item state for initial render, "Add Another Item", and form reset
function createEmptyItemState(): ItemInputState {
  return {
    itemType: '',
    brand: '',
    model: '',
    category: 'ELECTRICAL',
    brandModel: '',
    faultDescription: '',
    powerType: getDefaultPowerTypeForCategory('ELECTRICAL')
  };
}

/**
 * Station 1: Customer Self-Registration View (`/register`).
 * Allows visitors scanning the entrance QR code (or using an entrance kiosk tablet)
 * to check in their broken household item, accept House Rules, and receive a 4-character
 * alphanumeric reference token (`REF-XXXX`) to present at the Front Desk.
 */
export const CustomerRegisterView: React.FC<CustomerRegisterViewProps> = ({ session }) => {
  // Customer contact details and T&C agreement state
  const [firstName, setFirstName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [isTermsModalOpen, setIsTermsModalOpen] = useState(false);

  // Repair item description entries (defaulting to a single Electrical item)
  const [items, setItems] = useState<ItemInputState[]>([createEmptyItemState()]);

  // Autocomplete dropdown state for the Item Type input (tracks which item card has open suggestions)
  const [openTypeSuggestionItemIndex, setOpenTypeSuggestionItemIndex] = useState<number | null>(null);
  const [highlightedSuggestionIndex, setHighlightedSuggestionIndex] = useState<number>(0);

  // Submission status and generated reference token state
  const [submitting, setSubmitting] = useState(false);
  const [submissionResult, setSubmissionResult] = useState<{
    referenceToken: string;
    itemCount: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Protect in-progress registration forms and active REF-XXXX confirmation screens from auto-reload.
  // Once the visitor taps "Register Another Item" (handleReset), isRegisterDirty returns to false
  // and any waiting PWA update will automatically apply.
  const isRegisterDirty =
    firstName.trim().length > 0 ||
    contactPhone.trim().length > 0 ||
    agreedToTerms ||
    isTermsModalOpen ||
    submitting ||
    submissionResult !== null ||
    items.some(
      (i) =>
        i.itemType.trim().length > 0 ||
        i.brand.trim().length > 0 ||
        i.model.trim().length > 0 ||
        i.brandModel.trim().length > 0 ||
        i.faultDescription.trim().length > 0
    );
  useRegisterUnsavedWork(isRegisterDirty, 'customer-register-view');

  // Render an informational placeholder when no monthly session is currently active
  if (!session) {
    return (
      <div className="max-w-2xl mx-auto my-12 p-8 bg-white rounded-2xl shadow-sm border border-slate-200 text-center">
        <Info className="h-12 w-12 text-amber-500 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-slate-800">No Active Session Today</h2>
        <p className="mt-2 text-slate-600">
          The front desk has not opened today&apos;s repair café session yet. Please check back shortly or speak with an organiser.
        </p>
      </div>
    );
  }

  // Append an additional item slot when multi-item registration is enabled in cafeConfig (capped at 4)
  const handleAddItem = () => {
    if (items.length >= 4) return;
    setItems((prev) => [...prev, createEmptyItemState()]);
  };

  // Remove an item slot by index while ensuring at least one item remains in the form
  const handleRemoveItem = (index: number) => {
    if (items.length <= 1) return;
    setItems((prev) => prev.filter((_, i) => i !== index));
    if (openTypeSuggestionItemIndex === index) {
      setOpenTypeSuggestionItemIndex(null);
    }
  };

  // Update a specific field on an item entry, synchronising brandModel and Category / PowerType
  const handleItemChange = (index: number, field: keyof ItemInputState, value: string) => {
    setItems((prev) => {
      const copy = [...prev];
      const current = copy[index];

      if (field === 'category') {
        const category = value as ItemCategory;
        const autoPowerType = getDefaultPowerTypeForCategory(category);
        copy[index] = { ...current, category, powerType: autoPowerType };
      } else if (field === 'itemType') {
        // Resolve matching Category and PowerType as the customer types (e.g. "Toas" -> Toaster -> ELECTRICAL + MAINS_240V)
        const classification = resolveItemTypeClassification(value);
        const nextItem: ItemInputState = {
          ...current,
          itemType: value,
          ...(classification
            ? { category: classification.category, powerType: classification.powerType }
            : {})
        };
        nextItem.brandModel = formatItemBrandModel(nextItem);
        copy[index] = nextItem;
      } else if (field === 'brand' || field === 'model') {
        const nextItem: ItemInputState = {
          ...current,
          [field]: value
        };
        nextItem.brandModel = formatItemBrandModel(nextItem);
        copy[index] = nextItem;
      } else {
        copy[index] = { ...current, [field]: value };
      }

      return copy;
    });
  };

  // Apply a selected autocomplete suggestion to the item's Type, Category, Power Type, and concatenated brandModel
  const handleSelectItemTypeSuggestion = (index: number, suggestion: ItemTypeSuggestion) => {
    setItems((prev) => {
      const copy = [...prev];
      const current = copy[index];
      const nextItem: ItemInputState = {
        ...current,
        itemType: suggestion.label,
        category: suggestion.category,
        powerType: suggestion.powerType
      };
      nextItem.brandModel = formatItemBrandModel(nextItem);
      copy[index] = nextItem;
      return copy;
    });
    setOpenTypeSuggestionItemIndex(null);
    setHighlightedSuggestionIndex(0);
  };

  // Handle keyboard navigation (ArrowDown, ArrowUp, Enter, Escape) inside the Item Type autocomplete input
  const handleItemTypeKeyDown = (
    index: number,
    e: React.KeyboardEvent<HTMLInputElement>,
    suggestions: ItemTypeSuggestion[]
  ) => {
    if (suggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpenTypeSuggestionItemIndex(index);
      setHighlightedSuggestionIndex((prev) => (prev + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setOpenTypeSuggestionItemIndex(index);
      setHighlightedSuggestionIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter' && openTypeSuggestionItemIndex === index) {
      const targetSuggestion = suggestions[highlightedSuggestionIndex] ?? suggestions[0];
      if (targetSuggestion) {
        e.preventDefault();
        handleSelectItemTypeSuggestion(index, targetSuggestion);
      }
    } else if (e.key === 'Escape') {
      setOpenTypeSuggestionItemIndex(null);
    }
  };

  // Validate visitor inputs, generate a collision-safe reference token, and write the registration to Firestore
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Require visitor first name so Front Desk volunteers can call them up
    if (!firstName.trim()) {
      setError('Please provide your first name.');
      return;
    }
    // Enforce mandatory acceptance of Repair Café House Rules & disclaimer
    if (!agreedToTerms) {
      setError('Please accept the terms and house rules to proceed.');
      return;
    }

    // Build submission items with concatenated brandModel (from Brand, Model, and Item Type)
    const normalizedItems = items.map((item) => ({
      category: item.category,
      brandModel: formatItemBrandModel({
        itemType: item.itemType,
        brand: item.brand,
        model: item.model,
        fallbackBrandModel: item.brandModel
      }),
      faultDescription: item.faultDescription.trim(),
      powerType: item.powerType
    }));

    // Ensure every item has an item description (Type / Brand / Model) and a fault description
    for (let i = 0; i < normalizedItems.length; i++) {
      if (!normalizedItems[i].brandModel || !normalizedItems[i].faultDescription) {
        setError(`Please fill in the item details and fault for item #${i + 1}.`);
        return;
      }
    }

    setSubmitting(true);
    setError(null);

    try {
      // Generate a 4-character alphanumeric reference token (e.g. REF-A38F)
      const referenceToken = generateReferenceToken();
      const registrationId = `REG-${Date.now()}`;

      // Persist public repair item doc(s) and segregated private/customer GDPR subcollection doc
      await submitRegistration({
        sessionId: session.id,
        submission: {
          registrationId,
          referenceToken,
          customer: {
            firstName: firstName.trim(),
            contactPhone: contactPhone.trim() || undefined,
            agreedToTerms,
            termsVersion: cafeConfig.termsVersion
          },
          items: normalizedItems
        }
      });

      // Transition to the confirmation screen displaying the visitor's reference token
      setSubmissionResult({
        referenceToken,
        itemCount: normalizedItems.length
      });
    } catch (err: unknown) {
      console.error('Submission error:', err);
      const message = err instanceof Error ? err.message : 'Failed to register item. Please try again.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  // Reset the form and clear the confirmation screen so the next visitor can check in
  const handleReset = () => {
    setSubmissionResult(null);
    setFirstName('');
    setContactPhone('');
    setAgreedToTerms(false);
    setOpenTypeSuggestionItemIndex(null);
    setHighlightedSuggestionIndex(0);
    setItems([createEmptyItemState()]);
  };

  // Confirmation Screen: displayed after successful check-in until the visitor taps "Register Another Item"
  if (submissionResult) {
    return (
      <div className="max-w-xl mx-auto my-8 p-8 bg-white rounded-3xl shadow-lg border border-slate-200 text-center animate-fade-in">
        {/* Green checkmark badge confirming registration */}
        <div className="h-16 w-16 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 className="h-10 w-10" />
        </div>

        <h2 className="text-2xl font-black text-slate-800">You Are Checked In!</h2>
        <p className="mt-2 text-slate-600 text-sm">
          Please show this reference token to the Front Desk volunteer to collect your physical card.
        </p>

        {/* High-contrast Reference Token callout box for Front Desk lookup */}
        <div className="my-6 p-6 rounded-2xl bg-emerald-50 border-2 border-dashed border-emerald-500 inline-block w-full max-w-xs shadow-inner">
          <span className="block text-xs font-bold text-emerald-800 uppercase tracking-widest">
            Your Reference Token
          </span>
          <span className="text-4xl font-mono font-black text-emerald-900 tracking-wider">
            {submissionResult.referenceToken}
          </span>
        </div>

        {/* Step-by-step arrival instructions for the visitor */}
        <div className="bg-slate-50 rounded-xl p-4 text-left text-xs text-slate-600 space-y-2 mb-6 border border-slate-200">
          <div className="font-semibold text-slate-800 flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-amber-500" />
            What happens next:
          </div>
          <p>1. Head to the Front Desk table with your item.</p>
          <p>2. Give them reference <strong>{submissionResult.referenceToken}</strong>.</p>
          <p>3. They will assign your item a numbered card and guide you to the waiting area or PAT safety station.</p>
        </div>

        {/* Button to clear the confirmation screen and return the kiosk/phone to an idle registration form */}
        <button
          onClick={handleReset}
          className="w-full py-3 px-4 rounded-xl bg-slate-800 text-white font-bold text-sm hover:bg-slate-900 transition-colors"
        >
          Register Another Item
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto my-6 px-4">
      <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-6 sm:p-8">
        {/* Form Header */}
        <div className="flex items-center gap-3 pb-6 border-b border-slate-100">
          <div className="h-12 w-12 rounded-2xl bg-emerald-100 text-emerald-800 flex items-center justify-center">
            <ClipboardList className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900">
              Register Your Item
            </h2>
            <p className="text-xs sm:text-sm text-slate-500">
              Welcome to {cafeConfig.cafeName}. Please enter a few details about your item.
            </p>
          </div>
        </div>

        {/* Validation or submission error banner */}
        {error && (
          <div
            role="alert"
            className="mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm font-medium"
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-6">
          {/* Section 1: Customer Contact Details (stored in segregated GDPR subcollection) */}
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">
              1. Your Contact Details
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Visitor First Name input */}
              <div>
                <label
                  htmlFor="register-first-name"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  First Name <span className="text-rose-500">*</span>
                </label>
                <input
                  id="register-first-name"
                  type="text"
                  required
                  autoComplete="given-name"
                  placeholder="e.g. Sarah"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                />
              </div>

              {/* Optional Mobile Phone input for on-day collection notification */}
              <div>
                <label
                  htmlFor="register-contact-phone"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Mobile Phone{' '}
                  <span className="text-slate-600 font-normal">
                    (Optional, on-day collection only)
                  </span>
                </label>
                <input
                  id="register-contact-phone"
                  type="tel"
                  autoComplete="tel"
                  placeholder="e.g. 07123 456789"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                />
              </div>
            </div>
          </div>

          {/* Section 2: Broken Household Item Details */}
          <div className="space-y-4 pt-4 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">
                2. Item Details
              </h3>
              {/* Only render "Add Another Item" when allowed by fair-queue configuration */}
              {cafeConfig.allowMultiItemRegistration && items.length < 4 && (
                <button
                  type="button"
                  onClick={handleAddItem}
                  className="inline-flex items-center gap-1 text-xs font-bold text-brand-700 hover:text-brand-800"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" /> Add Another Item
                </button>
              )}
            </div>

            {/* Render input card for each item being registered */}
            {items.map((item, index) => {
              const typeSuggestions = getItemTypeSuggestions(item.itemType);
              const showTypeSuggestions =
                openTypeSuggestionItemIndex === index && typeSuggestions.length > 0;
              const excludedItemLabel = findExcludedItemMatch(item.itemType);

              return (
                <div
                  key={index}
                  className="p-5 rounded-2xl bg-slate-50 border border-slate-200 relative space-y-4"
                >
                  {/* Show item number header and remove button when multiple items are present */}
                  {items.length > 1 && (
                    <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                      <span className="text-xs font-bold text-slate-700 uppercase">Item #{index + 1}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveItem(index)}
                        aria-label={`Remove item ${index + 1}`}
                        className="text-rose-500 hover:text-rose-700 p-1"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  )}

                  {/* 1. Item Type input with autocomplete suggestions */}
                  <div className="relative">
                    <label
                      htmlFor={`register-item-${index}-type`}
                      className="block text-xs font-semibold text-slate-700 mb-1"
                    >
                      Item Type <span className="text-rose-500">*</span>
                    </label>
                    <input
                      id={`register-item-${index}-type`}
                      type="text"
                      required
                      autoComplete="off"
                      placeholder="Start typing e.g. Toaster, Kettle, Bicycle, Coat..."
                      value={item.itemType}
                      onFocus={() => {
                        setOpenTypeSuggestionItemIndex(index);
                        setHighlightedSuggestionIndex(0);
                      }}
                      onBlur={() => {
                        setOpenTypeSuggestionItemIndex((prev) => (prev === index ? null : prev));
                      }}
                      onChange={(e) => {
                        handleItemChange(index, 'itemType', e.target.value);
                        setOpenTypeSuggestionItemIndex(index);
                        setHighlightedSuggestionIndex(0);
                      }}
                      onKeyDown={(e) => handleItemTypeKeyDown(index, e, typeSuggestions)}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                    />

                    {/* Autocomplete dropdown menu suggesting matching item types and auto-selecting Category & Power Type */}
                    {showTypeSuggestions && (
                      <ul
                        id={`register-item-${index}-type-suggestions`}
                        aria-label="Suggested item types"
                        className="absolute z-20 left-0 right-0 mt-1 max-h-60 overflow-y-auto rounded-xl border border-slate-300 bg-white shadow-lg divide-y divide-slate-100"
                      >
                        {typeSuggestions.map((suggestion, suggestionIdx) => {
                          const isHighlighted = suggestionIdx === highlightedSuggestionIndex;
                          return (
                            <li key={suggestion.label}>
                              <button
                                type="button"
                                onMouseDown={(e) => {
                                  // Prevent input blur before selection completes on mouse/touch
                                  e.preventDefault();
                                  handleSelectItemTypeSuggestion(index, suggestion);
                                }}
                                onClick={() => handleSelectItemTypeSuggestion(index, suggestion)}
                                className={`w-full px-3.5 py-2.5 text-left flex items-center justify-between gap-2 text-sm transition-colors ${
                                  isHighlighted
                                    ? 'bg-emerald-50 text-emerald-950 font-semibold'
                                    : 'text-slate-800 hover:bg-slate-50'
                                }`}
                              >
                                <span className="font-semibold">{suggestion.label}</span>
                                <span className="text-xs text-slate-600">
                                  {CATEGORY_SHORT_LABELS[suggestion.category]} &bull;{' '}
                                  {getPowerTypeLabel(suggestion.powerType)}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}

                    {/* Advisory warning when the customer enters an item type in cafeConfig.excludedItems */}
                    {excludedItemLabel && (
                      <div
                        id={`register-excluded-warning-${index}`}
                        role="alert"
                        className="mt-2 p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs sm:text-sm flex items-start gap-2.5"
                      >
                        <AlertTriangle
                          className="h-4 w-4 text-amber-800 shrink-0 mt-0.5"
                          aria-hidden="true"
                        />
                        <span>
                          {cafeConfig.cafeName} does not generally repair items of type{' '}
                          <strong>{excludedItemLabel}</strong>, please see the Front Desk team to
                          confirm.
                        </span>
                      </div>
                    )}
                  </div>

                  {/* 2 & 3. Separate Brand and Model inputs to encourage visitors to provide both */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Brand text field */}
                    <div>
                      <label
                        htmlFor={`register-item-${index}-brand`}
                        className="block text-xs font-semibold text-slate-700 mb-1"
                      >
                        Brand
                      </label>
                      <input
                        id={`register-item-${index}-brand`}
                        type="text"
                        placeholder="e.g. Dualit, Dyson, Roberts"
                        value={item.brand}
                        onChange={(e) => handleItemChange(index, 'brand', e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                      />
                    </div>

                    {/* Model text field */}
                    <div>
                      <label
                        htmlFor={`register-item-${index}-model`}
                        className="block text-xs font-semibold text-slate-700 mb-1"
                      >
                        Model
                      </label>
                      <input
                        id={`register-item-${index}-model`}
                        type="text"
                        placeholder="e.g. Classic 4-Slice, V8, Revival"
                        value={item.model}
                        onChange={(e) => handleItemChange(index, 'model', e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                      />
                    </div>
                  </div>

                  {/* 4 & 5. Category and Power Type selectors (auto-set by Item Type, adjustable by visitor) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Repair Category selector */}
                    <div>
                      <label
                        htmlFor={`register-item-${index}-category`}
                        className="block text-xs font-semibold text-slate-700 mb-1"
                      >
                        Category <span className="text-rose-500">*</span>
                      </label>
                      <select
                        id={`register-item-${index}-category`}
                        value={item.category}
                        onChange={(e) => handleItemChange(index, 'category', e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                      >
                        <option value="ELECTRICAL">Electrical &amp; Electronics (Appliances, Audio, Computing, Lamps)</option>
                        <option value="MECHANICAL">Mechanical / Clocks / Bikes / Tools</option>
                        <option value="TEXTILES">Textiles / Clothing / Zips</option>
                        <option value="WOODWORK">Woodwork / Furniture</option>
                        <option value="TOY">Toys / Dolls / Gadgets</option>
                        <option value="OTHER">Other / Miscellaneous</option>
                      </select>
                    </div>

                    {/* Power Type selector (determines whether PAT 1 electrical safety testing is required) */}
                    <div>
                      <label
                        htmlFor={`register-item-${index}-power`}
                        className="block text-xs font-semibold text-slate-700 mb-1"
                      >
                        Power Type <span className="text-rose-500">*</span>
                      </label>
                      <select
                        id={`register-item-${index}-power`}
                        value={item.powerType}
                        onChange={(e) => handleItemChange(index, 'powerType', e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                      >
                        {/* Render shared power type options so registration and PAT station labels stay in sync */}
                        {POWER_TYPE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* 6. Fault Description textarea */}
                  <div>
                    <label
                      htmlFor={`register-item-${index}-fault`}
                      className="block text-xs font-semibold text-slate-700 mb-1"
                    >
                      What is the fault / what needs fixing? <span className="text-rose-500">*</span>
                    </label>
                    <textarea
                      id={`register-item-${index}-fault`}
                      required
                      rows={2}
                      placeholder="e.g. Lever does not stay down; won't heat up; cord is frayed."
                      value={item.faultDescription}
                      onChange={(e) => handleItemChange(index, 'faultDescription', e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Section 3: Terms & Conditions Acceptance */}
          <div className="pt-4 border-t border-slate-100 space-y-3">
            <div className="flex items-start gap-3">
              <input
                id="terms"
                type="checkbox"
                checked={agreedToTerms}
                onChange={(e) => setAgreedToTerms(e.target.checked)}
                className="h-5 w-5 mt-0.5 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              />
              <label htmlFor="terms" className="text-xs sm:text-sm text-slate-700 leading-snug">
                I agree to the{' '}
                <button
                  type="button"
                  onClick={() => setIsTermsModalOpen(true)}
                  className="font-bold text-brand-700 underline hover:text-brand-800"
                >
                  {cafeConfig.cafeName} Terms & House Rules
                </button>
                . I understand repairs are done on a volunteer best-effort basis without warranty or guarantee.
              </label>
            </div>
          </div>

          {/* Primary Submit Button */}
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3.5 px-4 rounded-xl bg-brand-600 text-white font-bold text-sm sm:text-base hover:bg-brand-700 active:bg-brand-800 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 shadow-sm"
          >
            {submitting ? (
              <span>Submitting...</span>
            ) : (
              <>
                <span>Complete Registration</span>
                <ArrowRight className="h-5 w-5" />
              </>
            )}
          </button>
        </form>
      </div>

      {/* Modal displaying the Repair Café's full Terms & Conditions and House Rules */}
      <TermsModal
        isOpen={isTermsModalOpen}
        onClose={() => setIsTermsModalOpen(false)}
        onAccept={() => setAgreedToTerms(true)}
      />
    </div>
  );
};
