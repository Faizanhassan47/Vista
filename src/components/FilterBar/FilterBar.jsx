import { useEffect, useId, useMemo, useRef, useState } from 'react';
import './FilterBar.css';

function AutocompleteControl({ field }) {
  const [options, setOptions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);
  const generatedId = useId();
  const listId = `filter-suggestions-${generatedId.replace(/:/g, '')}`;
  const sourceOptions = useMemo(() => {
    if (field.loadOptions) return null;
    const values = typeof field.getSuggestions === 'function' ? field.getSuggestions() : field.suggestions;
    return [...new Set((values || []).filter((value) => value !== null && value !== undefined && String(value).trim()).map((value) => String(value).trim()))];
  }, [field.getSuggestions, field.suggestions]);

  useEffect(() => {
    const term = String(field.value || '').trim();
    if (!isOpen || term.length < 1) { setOptions([]); return undefined; }
    if (sourceOptions) {
      const normalizedTerm = term.toLocaleLowerCase();
      setOptions(sourceOptions.filter((option) => option.toLocaleLowerCase().includes(normalizedTerm)).slice(0, 8).map((value) => ({ id: value, value })));
      setSearching(false);
      return undefined;
    }
    if (!field.loadOptions) { setOptions([]); return undefined; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try { setOptions(await field.loadOptions(term, controller.signal)); }
      catch (error) { if (error.name !== 'AbortError') setOptions([]); }
      finally { if (!controller.signal.aborted) setSearching(false); }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [field.value, field.loadOptions, isOpen, sourceOptions]);

  useEffect(() => {
    const closeOnOutsideClick = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) setIsOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, []);

  return <div className="library-filters__autocomplete-control" ref={containerRef}>
    <input placeholder={field.placeholder || 'Search ...'} value={field.value} onChange={(event) => { field.onChange(event.target.value); setIsOpen(true); }} onFocus={() => setIsOpen(true)} onKeyDown={(event) => { if (event.key === 'Escape') setIsOpen(false); }} autoComplete="off" aria-autocomplete="list" aria-expanded={isOpen && (searching || options.length > 0)} aria-controls={listId} />
    {isOpen && (searching || options.length > 0) && <div id={listId} className="library-filters__suggestions" role="listbox">
      {searching && <span className="library-filters__suggestion-status">Searching...</span>}
      {options.map((option) => <button type="button" key={option.id || option.value} role="option" onPointerDown={(event) => event.preventDefault()} onClick={() => { field.onChange(option.value); setOptions([]); setIsOpen(false); }}>{field.renderOption ? field.renderOption(option) : option.value}</button>)}
    </div>}
  </div>;
}

function FilterField({ field }) {
  if (field.type === 'dateRange') return <label className="library-filters__field library-filters__date-field">{field.label}<div>
    <span>From</span><input type="date" aria-label={`${field.label} from date`} value={field.from} onChange={(event) => field.onFromChange(event.target.value)} />
    <span>To</span><input type="date" aria-label={`${field.label} to date`} value={field.to} onChange={(event) => field.onToChange(event.target.value)} min={field.toMin || undefined} />
  </div></label>;
  if (field.type === 'select') return <label className="library-filters__field">{field.label}<select value={field.value} onChange={(event) => field.onChange(event.target.value)}>{field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
  const hasSuggestions = field.type === 'autocomplete' || field.suggestions?.length || field.getSuggestions;
  const normalizedField = field.type === 'autocomplete' ? field : { ...field, suggestions: field.suggestions || [] };
  return <label className={`library-filters__field${hasSuggestions ? ' library-filters__autocomplete' : ''}`}>
    {field.label}{hasSuggestions ? <AutocompleteControl field={normalizedField} /> : <input placeholder={field.placeholder || 'Search ...'} value={field.value} onChange={(event) => field.onChange(event.target.value)} />}
  </label>;
}

export default function FilterBar({ title, fields = [], children, label, className = '', layout = 'default' }) {
  const classes = ['library-filters', `library-filters--${layout}`, className].filter(Boolean).join(' ');
  return <section className={classes} aria-label={label || (title ? `${title} filters` : 'Filters')}>
    {title && <h2>{title}</h2>}
    {fields.length > 0 ? <div className={`library-filters__grid library-filters__grid--${layout}`}>
      {fields.map((field) => <FilterField key={field.label} field={field} />)}
      {children}
    </div> : children}
  </section>;
}
