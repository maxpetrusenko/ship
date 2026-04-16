# External API Access

Ship exposes its REST API through the same server used by the web app.

Production docs:

- Swagger UI: `https://ship.maxpetrusenko.com/api/docs/`
- OpenAPI JSON: `https://ship.maxpetrusenko.com/api/openapi.json`
- OpenAPI YAML: `https://ship.maxpetrusenko.com/api/openapi.yaml`

## Authentication

External clients should use API tokens with the standard bearer header:

```sh
curl https://ship.maxpetrusenko.com/api/projects \
  -H "Authorization: Bearer ship_your_token_here"
```

API tokens are workspace-scoped. They are returned once when created, then only
their `token_prefix` is shown later.

## Create a Token

Users can create tokens from the app under workspace settings.

You can also create a token through the API after session login:

```sh
BASE_URL="https://ship.maxpetrusenko.com"

curl -c cookies.txt "$BASE_URL/api/csrf-token"

CSRF_TOKEN="paste_token_from_previous_response"

curl -b cookies.txt -c cookies.txt \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $CSRF_TOKEN" \
  -d '{"email":"dev@ship.local","password":"admin123"}' \
  "$BASE_URL/api/auth/login"

curl -b cookies.txt \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $CSRF_TOKEN" \
  -d '{"name":"External client","expires_in_days":30}' \
  "$BASE_URL/api/api-tokens"
```

## Common Requests

```sh
TOKEN="ship_your_token_here"
BASE_URL="https://ship.maxpetrusenko.com"

curl "$BASE_URL/api/projects" \
  -H "Authorization: Bearer $TOKEN"

curl "$BASE_URL/api/issues?state=todo" \
  -H "Authorization: Bearer $TOKEN"

curl "$BASE_URL/api/documents?type=wiki" \
  -H "Authorization: Bearer $TOKEN"

curl "$BASE_URL/api/search/documents?q=onboarding" \
  -H "Authorization: Bearer $TOKEN"
```

State-changing requests also use the bearer token. They do not need CSRF tokens:

```sh
curl -X POST "$BASE_URL/api/issues" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Imported task","priority":"medium","state":"backlog"}'
```
