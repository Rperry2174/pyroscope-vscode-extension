package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math/rand"
	"net/http"
	"time"
)

type Order struct {
	ID        string  `json:"id"`
	UserID    string  `json:"user_id"`
	Amount    float64 `json:"amount"`
	Currency  string  `json:"currency"`
	Status    string  `json:"status"`
	Timestamp int64   `json:"timestamp"`
}

func main() {
	http.HandleFunc("/api/orders", handleOrders)
	http.HandleFunc("/api/process", handleProcess)

	log.Println("Server starting on :8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
}

func handleOrders(w http.ResponseWriter, r *http.Request) {
	orders := generateOrders(100)
	json.NewEncoder(w).Encode(orders)
}

func handleProcess(w http.ResponseWriter, r *http.Request) {
	var order Order
	if err := json.NewDecoder(r.Body).Decode(&order); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// This is a hot spot - processOrder is expensive
	result := processOrder(order)
	json.NewEncoder(w).Encode(result)
}

// HOT SPOT: This function consumes 34.5% of CPU time
func processOrder(order Order) Order {
	// Simulate expensive validation
	if !validateInput(order) {
		order.Status = "invalid"
		return order
	}

	// Simulate database operations
	order.Amount = calculateTotal(order)

	// Simulate external API calls
	data := fetchData(order.UserID)
	processData(data)

	order.Status = "processed"
	order.Timestamp = time.Now().Unix()

	return order
}

// HOT SPOT: 12.3% of CPU time - validation is slow
func validateInput(order Order) bool {
	// Expensive string operations
	if len(order.ID) == 0 || len(order.UserID) == 0 {
		return false
	}

	// Simulate complex validation logic
	for i := 0; i < 1000; i++ {
		_ = fmt.Sprintf("%s-%s-%d", order.ID, order.UserID, i)
	}

	return order.Amount > 0
}

// HOT SPOT: 18.7% of CPU time - calculations are intensive
func calculateTotal(order Order) float64 {
	total := order.Amount

	// Simulate expensive calculations
	for i := 0; i < 5000; i++ {
		total += float64(i) * 0.001
		total = total * 1.0001
	}

	// Apply fees
	fee := total * 0.029
	total += fee

	return total
}

// HOT SPOT: 9.8% of CPU time - I/O bound
func fetchData(userID string) map[string]interface{} {
	// Simulate slow database query
	time.Sleep(10 * time.Millisecond)

	data := make(map[string]interface{})
	data["user_id"] = userID
	data["preferences"] = generatePreferences()
	data["history"] = generateHistory()

	return data
}

func processData(data map[string]interface{}) {
	// Simulate data processing
	_ = parseJSON(data)
	writeLog(data)
}

// HOT SPOT: 7.1% of CPU time
func parseJSON(data map[string]interface{}) []byte {
	result, _ := json.Marshal(data)

	// Simulate parsing overhead
	for i := 0; i < 100; i++ {
		var temp map[string]interface{}
		json.Unmarshal(result, &temp)
	}

	return result
}

// HOT SPOT: 4.5% of CPU time
func writeLog(data map[string]interface{}) {
	logEntry := fmt.Sprintf("[%s] Processing: %v", time.Now().Format(time.RFC3339), data)

	// Simulate log writing
	_ = io.Discard.Write([]byte(logEntry))
}

func formatOutput(data interface{}) string {
	output, _ := json.MarshalIndent(data, "", "  ")
	return string(output)
}

func generateOrders(count int) []Order {
	orders := make([]Order, count)
	for i := 0; i < count; i++ {
		orders[i] = Order{
			ID:       fmt.Sprintf("ORD-%d", i),
			UserID:   fmt.Sprintf("USER-%d", rand.Intn(100)),
			Amount:   rand.Float64() * 1000,
			Currency: "USD",
			Status:   "pending",
		}
	}
	return orders
}

func generatePreferences() map[string]string {
	return map[string]string{
		"currency":     "USD",
		"notification": "email",
		"theme":        "dark",
	}
}

func generateHistory() []string {
	history := make([]string, 10)
	for i := 0; i < 10; i++ {
		history[i] = fmt.Sprintf("ORDER-%d", rand.Intn(1000))
	}
	return history
}

func cleanup() {
	// Cleanup logic
	log.Println("Cleaning up resources...")
}
