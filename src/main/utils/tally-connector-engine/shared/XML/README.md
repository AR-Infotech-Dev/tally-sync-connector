# Shared import envelope

Only `import-envelope.xml.hbs` remains here. It wraps rendered voucher messages in a Tally Import Data request and conditionally adds the selected company.
All 57 small fragment templates have been removed.
Each of the six voucher folders now owns one complete `<voucher>.xml.hbs` with its own item loops, optional GST, batch, bill, due-date and custom-field sections.
Mappers return data; they do not render nested XML.
