export function resolveVoucherItemCodes(voucher, company, resolveItem) {
  const header = voucher.header || voucher;
  const items = voucher.items || voucher.line_items || voucher.lineItems || header.items;
  if (!Array.isArray(items) || !items.some((item) => item?.item_code !== undefined)) return voucher;
  return {
    ...voucher,
    items: items.map((item) =>
      item?.item_code === undefined ? item : { ...item, ...resolveItem({ ...item, company }) },
    ),
  };
}
