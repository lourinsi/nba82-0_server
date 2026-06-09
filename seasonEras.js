function seasonEndYear(season) {
  const value = String(season || "").trim();
  const fullYearRange = value.match(/^(\d{4})\D+(\d{4})/);

  if (fullYearRange) {
    return Number(fullYearRange[2]);
  }

  const shortYearRange = value.match(/^(\d{4})\D+(\d{2})/);
  if (shortYearRange) {
    const startYear = Number(shortYearRange[1]);
    const endYearSuffix = Number(shortYearRange[2]);
    const startCentury = Math.floor(startYear / 100) * 100;
    const endYear = startCentury + endYearSuffix;

    return endYear > startYear ? endYear : endYear + 100;
  }

  const singleYear = value.match(/\d{4}/);
  return singleYear ? Number(singleYear[0]) : null;
}

function decadeLabelFromYear(year) {
  const numericYear = Number(year);

  if (!numericYear || Number.isNaN(numericYear) || numericYear < 1940) {
    return null;
  }

  const decade = Math.floor((numericYear % 100) / 10) * 10;
  return `${String(decade).padStart(2, "0")}'s`;
}

function seasonEra(season) {
  return decadeLabelFromYear(seasonEndYear(season));
}

function eraSortValue(era) {
  const decade = Number(String(era).slice(0, 2));
  return Number.isNaN(decade) ? 999 : decade;
}

module.exports = {
  decadeLabelFromYear,
  eraSortValue,
  seasonEndYear,
  seasonEra,
};
