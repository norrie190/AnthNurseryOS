import type {
  PlantFormField,
  PlantFormState,
  PlantFormValues,
  PlantSelectOption,
} from '../plant-form-state';
import styles from './plant-management.module.css';

type ParentSelectorProps = {
  role: 'seed' | 'pollen';
  values: PlantFormValues;
  onChange: (field: PlantFormField, value: string) => void;
  errors: PlantFormState['fieldErrors'];
  options: readonly PlantSelectOption[];
  emptyMessage?: string;
};

export function ParentSelector({
  role,
  values,
  onChange,
  errors,
  options,
  emptyMessage = 'No existing Plants yet. Choose Unknown or enter an external name.',
}: ParentSelectorProps) {
  const mode = `${role}ParentMode` as const;
  const plantId = `${role}ParentPlantId` as const;
  const name = `${role}ParentName` as const;
  return (
    <fieldset className={styles.parentGroup}>
      <legend>{role === 'seed' ? 'Seed parent' : 'Pollen parent'}</legend>
      <div className={styles.parentChoices} id={`plant-${mode}`} tabIndex={-1}>
        {(
          [
            ['unknown', 'Unknown'],
            ['existing', 'Existing Plant'],
            ['external', 'External name'],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className={styles.radioLabel}>
            <input
              type="radio"
              name={mode}
              value={value}
              checked={values[mode] === value}
              disabled={value === 'existing' && options.length === 0}
              onChange={() => onChange(mode, value)}
              aria-describedby={errors[mode] ? `plant-${mode}-error` : undefined}
            />
            {label}
          </label>
        ))}
      </div>
      {errors[mode] && (
        <p className={styles.fieldError} id={`plant-${mode}-error`}>
          {errors[mode]}
        </p>
      )}
      {options.length === 0 && <p className={styles.hint}>{emptyMessage}</p>}
      {values[mode] === 'existing' && (
        <div className={styles.field}>
          <label htmlFor={`plant-${plantId}`}>Existing {role} parent</label>
          <select
            id={`plant-${plantId}`}
            name={plantId}
            value={values[plantId]}
            onChange={(event) => onChange(plantId, event.target.value)}
            aria-invalid={!!errors[plantId]}
            aria-describedby={errors[plantId] ? `plant-${plantId}-error` : undefined}
          >
            <option value="">Choose a Plant</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          {errors[plantId] && (
            <p id={`plant-${plantId}-error`} className={styles.fieldError}>
              {errors[plantId]}
            </p>
          )}
        </div>
      )}
      {values[mode] === 'external' && (
        <div className={styles.field}>
          <label htmlFor={`plant-${name}`}>External {role} parent name</label>
          <input
            id={`plant-${name}`}
            name={name}
            value={values[name]}
            onChange={(event) => onChange(name, event.target.value)}
            aria-invalid={!!errors[name]}
            aria-describedby={errors[name] ? `plant-${name}-error` : undefined}
          />
          {errors[name] && (
            <p id={`plant-${name}-error`} className={styles.fieldError}>
              {errors[name]}
            </p>
          )}
        </div>
      )}
    </fieldset>
  );
}
