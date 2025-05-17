from backend.processes import buildSchema

with open("request.json", "r", encoding="utf-8") as f:
    data = f.read()
    result = buildSchema(data)

with open("schema.xsd", "w", encoding="utf-8") as f:
    f.write(result)
