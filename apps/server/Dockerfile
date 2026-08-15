FROM golang:1.26-alpine AS build

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags='-s -w' -o /out/api ./cmd/api \
    && CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags='-s -w' -o /out/migrate ./cmd/migrate \
    && CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags='-s -w' -o /out/seed-owner ./cmd/seed-owner

FROM alpine:3.22

RUN apk add --no-cache ca-certificates \
    && addgroup -S brigames \
    && adduser -S -G brigames -h /app brigames

WORKDIR /app
COPY --from=build /out/api /out/migrate /out/seed-owner ./
COPY --from=build /src/migrations ./migrations

USER brigames
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD wget -q --spider http://127.0.0.1:8080/health || exit 1

CMD ["./api"]
