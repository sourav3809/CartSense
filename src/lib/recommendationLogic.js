export function computeAcceptanceRate(acceptCount = 0, shownCount = 0) {
  if (shownCount === 0) return 0;
  return acceptCount / shownCount;
}

export function sortRecommendationsByAcceptance(recommendations = []) {
  return [...recommendations].sort((a, b) => {
    const rateA = computeAcceptanceRate(a.accept_count || 0, a.shown_count || 0);
    const rateB = computeAcceptanceRate(b.accept_count || 0, b.shown_count || 0);
    return rateB - rateA;
  });
}
