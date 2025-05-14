package auth

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/golang-jwt/jwt"
)

var jwtSecret = []byte("your-secret-key")

type LoginResponse struct {
	Token        string `json:"token"`
	RedirectPath string `json:"redirect_path"`
}

type User struct {
	ID       string `json:"user_id"`
	Username string `json:"username"`
	Password string `json:"password"`
	Role     string `json:"role"` // e.g., "admin", "editor", "viewer"
}

func GetUserByUsername(username string) (User, error) {
	return User{
		ID:       "1",
		Username: username,
		Password: "$2a$10$EIX5Q1Z5x1z5x1z5x1z5xO", // hashed password for "password"
		Role:     "admin",                         // example role
	}, nil
}

func LoginHandler(w http.ResponseWriter, r *http.Request) {
	var creds struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&creds); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	user, err := GetUserByUsername(creds.Username)
	if err != nil {
		http.Error(w, "User not found", http.StatusUnauthorized)
		return
	}

	// if bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(creds.Password)) != nil {
	// 	http.Error(w, "Invalid credentials", http.StatusUnauthorized)
	// 	return
	// }

	// Create JWT
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": user.ID,
		"role":    user.Role,
		"exp":     time.Now().Add(24 * time.Hour).Unix(),
	})

	fmt.Println("Login role:", user.Role)

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
