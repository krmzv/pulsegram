package state

type Transition string

const (
	StayUp      Transition = "stay-up"
	Recovered   Transition = "recovered"
	PendingDown Transition = "pending-down"
	WentDown    Transition = "went-down"
	StayDown    Transition = "stay-down"
)

// Decide returns the state transition after a single check.
// failCount is the consecutive-failure count already incremented for this result.
func Decide(prevStatus, checkStatus string, failCount, retries int) Transition {
	if checkStatus == "up" {
		if prevStatus == "down" {
			return Recovered
		}
		return StayUp
	}
	if prevStatus == "down" {
		return StayDown
	}
	if failCount >= retries {
		return WentDown
	}
	return PendingDown
}
