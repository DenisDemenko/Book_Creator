"use strict";
window.WoodSpecies = (() => {
  const defaults = ["Дуб", "Ясен", "Горіх", "Каповий тополь", "Бук"];
  const normalize = (value) =>
    String(value).trim().toLocaleLowerCase("uk-UA").replace(/\s+/g, " ");
  const aliases = new Map([
    ["oak", "Дуб"],
    ["ash", "Ясен"],
    ["ясень", "Ясен"],
    ["walnut", "Горіх"],
    ["орех", "Горіх"],
    ["beech", "Бук"],
    ["капова тополя", "Каповий тополь"],
    ["тополя капова", "Каповий тополь"],
    ["каповый тополь", "Каповий тополь"],
    ["poplar burl", "Каповий тополь"],
    ...defaults.map((name) => [normalize(name), name]),
  ]);
  const key = (value) => normalize(aliases.get(normalize(value)) || value);
  const options = (slabs) => {
    const labels = new Map(defaults.map((name) => [key(name), name]));
    slabs.forEach((s) => {
      if (!labels.has(key(s.species)))
        labels.set(key(s.species), s.species.trim());
    });
    return [...labels].map(([value, label]) => ({ value, label }));
  };
  return { key, options };
})();
