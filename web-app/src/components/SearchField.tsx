type Props = {
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  placeholder?: string;
};

/** the account search pill — pair it with `useAccountSearch` */
export default function SearchField({ value, onChange, autoFocus, placeholder = "search accounts" }: Props) {
  return (
    <div className="search">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.6" />
        <path d="M16 16 L21 21" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label="search accounts"
        autoFocus={autoFocus}
      />
      {value && (
        <button className="search-clear" type="button" onClick={() => onChange("")} aria-label="clear">
          ×
        </button>
      )}
    </div>
  );
}
