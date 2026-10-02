"""Regenerate lib/materialMaster.json from a Material Management export.

Usage:
    python3 tools/convert_material_master.py Material_Management_5cols.xlsx

Expects 5 columns in this order (header row + data, first sheet):
    Material code | Material name | Category Code | Category Type | base unit

Writes lib/materialMaster.json as:
    { "<material code>": { "name", "categoryCode", "categoryName", "uom" }, ... }

After running this, commit lib/materialMaster.json and redeploy — same as
any other code change. A Material code missing from the file just falls
back to manual entry in the app (Override), so it's safe if the list is a
little out of date.
"""
import json
import sys

import openpyxl


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)

    wb = openpyxl.load_workbook(sys.argv[1], data_only=True)
    ws = wb.worksheets[0]

    mapping = {}
    for row in ws.iter_rows(min_row=2, values_only=True):
        if not row or row[0] is None:
            continue
        code, name, cat_code, cat_name, uom = row[0], row[1], row[2], row[3], row[4]
        mapping[str(code).strip()] = {
            "name": str(name).strip() if name is not None else "",
            "categoryCode": str(cat_code).strip() if cat_code is not None else "",
            "categoryName": str(cat_name).strip() if cat_name is not None else "",
            "uom": str(uom).strip() if uom is not None else "",
        }

    with open("lib/materialMaster.json", "w", encoding="utf-8") as f:
        json.dump(mapping, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)

    print(f"Wrote {len(mapping)} materials to lib/materialMaster.json")


if __name__ == "__main__":
    main()
