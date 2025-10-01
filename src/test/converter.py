# This will format the "R01" -> "R13" into "Special Parents": {"R01" ... "R13"}

import json

# Load JSON file
with open("input.json", "r") as f:
    data = json.load(f)

# Transform each entry
for entry in data["durations"]:
    # Extract all Rxx keys
    special_parents = {k: v for k, v in entry.items() if k.startswith("R")}
    
    # Remove them from the root
    for k in special_parents:
        del entry[k]
    
    # Add nested object
    entry["Special Parents"] = special_parents

# Save updated JSON
with open("data_updated.json", "w") as f:
    json.dump(data, f, indent=2)