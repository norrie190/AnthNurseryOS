import styles from '@/modules/plants/components/plant-management.module.css';

export default function PlantsLoading() {
  return (
    <div className={styles.page}>
      <p role="status">Loading Plants…</p>
    </div>
  );
}
