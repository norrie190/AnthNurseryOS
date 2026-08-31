'use client';

export default function TariffError({ reset }: { reset: () => void }) {
  return (
    <section role="alert">
      <h1>Electricity tariffs are unavailable</h1>
      <p>We could not load the tariff history. Please try again.</p>
      <button onClick={reset}>Try again</button>
    </section>
  );
}
