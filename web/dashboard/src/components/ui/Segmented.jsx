// Member 2: segmented control: a group of aria-pressed buttons on a grey track.
export default function Segmented({ label, options, value, onChange, large = false }) {
  return (
    <div className={`segmented${large ? ' segmented-lg' : ''}`} role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}
