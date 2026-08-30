import Link from 'next/link';
import styles from '@/modules/plants/components/plant-management.module.css';

export default function PlantsPage() {
  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <p className={styles.eyebrow}>Your collection</p>
        <h1>Plants</h1>
        <p>Keep a record of each Plant, its parentage and purchase information.</p>
      </header>
      <section className={styles.card} aria-labelledby="add-plant-heading">
        <h2 id="add-plant-heading">Add a Plant to your nursery</h2>
        <p className={styles.sectionIntro}>
          Each Plant receives a permanent ANT reference when saved. You can view its record straight
          after adding it.
        </p>
        <Link href="/plants/new" className={styles.primaryButton}>
          Add Plant
        </Link>
        <p className={styles.hint}>The full collection list will be added in a later stage.</p>
      </section>
    </div>
  );
}
