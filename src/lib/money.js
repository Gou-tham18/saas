export function formatMoney(cents, currency = 'usd') {
  const amount = cents / 100;
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  });
  return formatter.format(amount);
}
