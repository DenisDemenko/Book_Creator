import {
  blankFurnitureProduct,
  type FurnitureProduct,
} from "./furnitureProduct";
export function constructorCard(p: any): FurnitureProduct {
  return {
    ...blankFurnitureProduct(),
    id: "CP-" + p.id,
    sku: "CP-" + p.id.slice(0, 12),
    name: p.details.title,
    teaser: p.details.summary || p.details.description.slice(0, 300),
    description: p.details.description,
    category: p.subject,
    marketplaceCategory: p.details.categorySlug,
    leadTime: p.details.leadTime,
    priceUah: p.calculation.sellingMinor / 100,
    status: p.publishedRevision === p.revision ? "published" : "draft",
    physical: true,
    stock: null,
    dimensions:
      [
        p.snapshot.summary.width,
        p.snapshot.summary.depth,
        p.snapshot.summary.height,
      ].join(" × ") + " мм",
    material: (p.snapshot.summary.materials || []).join(", "),
    ...p.details.publicAttributes,
    media: p.media.map((m) => ({
      id: m.id,
      label: m.name,
      kind: "image",
      src: "/api/admin/constructor-products/" + p.id + "/media/" + m.id,
    })),
    constructorSource: {
      id: p.id,
      revision: p.revision,
      subject: p.subject,
      tariffVersion: p.calculation.tariffVersion,
      quote: p.calculation,
      bom: p.snapshot.bom,
      quantities: p.details.quantities || {},
      commercial: p.details.commercial || {},
    },
    updatedAt: p.updatedAt,
  };
}
