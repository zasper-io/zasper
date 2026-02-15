package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/rs/zerolog/log"
	"github.com/zasper-io/zasper/internal/core"
)

var jwtSecret = []byte("your-secret-key")

func JwtAuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" || len(authHeader) < 8 || authHeader[:7] != "Bearer " {
			http.Error(w, "Missing or invalid Authorization header", http.StatusUnauthorized)
			return
		}
		tokenStr := authHeader[7:]

		token, err := jwt.Parse(tokenStr, func(token *jwt.Token) (interface{}, error) {
			// Make sure the signing method is HMAC
			if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("unexpected signing method")
			}
			return jwtSecret, nil
		})

		if err != nil || !token.Valid {
			http.Error(w, "Invalid token", http.StatusUnauthorized)
			return
		}

		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok || claims["user_id"] == nil {
			http.Error(w, "Invalid token claims", http.StatusUnauthorized)
			return
		}

		userID := claims["user_id"].(string)
		ctx := context.WithValue(r.Context(), "user_id", userID)
		// ctx = context.WithValue(ctx, "role", claims["role"].(string))
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

type LoginResponse struct {
	Token        string `json:"token"`
	RedirectPath string `json:"redirect_path"`
}

type User struct {
	ID       string `json:"user_id"`
	Username string `json:"username"`
	Role     string `json:"role"` // e.g., "admin", "editor", "viewer"
}

func GetUserByUsername(username string) (User, error) {
	return User{
		ID:       "1",
		Username: core.Zasper.UserName,
		Role:     "user",
	}, nil
}

func LoginHandler(w http.ResponseWriter, r *http.Request) {
	var creds struct {
		AccessToken string `json:"accessToken"`
	}
	if err := json.NewDecoder(r.Body).Decode(&creds); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	user, err := GetUserByUsername(creds.AccessToken)
	if err != nil {
		http.Error(w, "User not found", http.StatusUnauthorized)
		return
	}
	if creds.AccessToken != core.ServerAccessToken {
		http.Error(w, "Invalid credentials", http.StatusUnauthorized)
		return
	}

	// Create JWT
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": user.ID,
		"role":    user.Role,
		"exp":     time.Now().Add(24 * time.Hour).Unix(),
	})

	log.Debug().Msgf("Login role: %v", user.Role)

	tokenString, err := token.SignedString(jwtSecret)
	if err != nil {
		http.Error(w, "Could not generate token", http.StatusInternalServerError)
		return
	}
	redirectPath := "/"
	if user.Role == "admin" {
		redirectPath = "/"
	}

	resp := LoginResponse{
		Token:        tokenString,
		RedirectPath: redirectPath,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}
