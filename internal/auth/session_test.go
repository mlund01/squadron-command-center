package auth

import (
	"strings"
	"time"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var testSecret = []byte("0123456789abcdef0123456789abcdef")

var _ = Describe("Session", func() {
	Describe("encodeSession / decodeSession", func() {
		It("round-trips a valid session", func() {
			s := Session{
				Sub:     "user-42",
				Email:   "alice@example.com",
				Name:    "Alice",
				Expires: time.Now().Add(time.Hour).Unix(),
			}
			enc, err := encodeSession(s, testSecret)
			Expect(err).NotTo(HaveOccurred())

			got, err := decodeSession(enc, testSecret)
			Expect(err).NotTo(HaveOccurred())
			Expect(got.Sub).To(Equal(s.Sub))
			Expect(got.Email).To(Equal(s.Email))
			Expect(got.Name).To(Equal(s.Name))
		})

		It("rejects a tampered payload", func() {
			s := Session{Email: "a@b.c", Expires: time.Now().Add(time.Hour).Unix()}
			enc, err := encodeSession(s, testSecret)
			Expect(err).NotTo(HaveOccurred())

			dot := strings.IndexByte(enc, '.')
			Expect(dot).To(BeNumerically(">=", 2))

			// Flip a character in the payload
			tampered := enc[:dot-1] + flipASCII(enc[dot-1:dot]) + enc[dot:]
			_, err = decodeSession(tampered, testSecret)
			Expect(err).To(HaveOccurred())
		})

		It("rejects a wrong secret", func() {
			s := Session{Email: "a@b.c", Expires: time.Now().Add(time.Hour).Unix()}
			enc, err := encodeSession(s, testSecret)
			Expect(err).NotTo(HaveOccurred())

			other := []byte("XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX")
			_, err = decodeSession(enc, other)
			Expect(err).To(HaveOccurred())
		})

		It("rejects an expired session", func() {
			s := Session{Email: "a@b.c", Expires: time.Now().Add(-time.Minute).Unix()}
			enc, err := encodeSession(s, testSecret)
			Expect(err).NotTo(HaveOccurred())

			_, err = decodeSession(enc, testSecret)
			Expect(err).To(MatchError(ContainSubstring("expired")))
		})

		DescribeTable("rejects invalid formats",
			func(value string) {
				_, err := decodeSession(value, testSecret)
				Expect(err).To(HaveOccurred())
			},
			Entry("empty string", ""),
			Entry("no dot separator", "no-dot-separator"),
			Entry("just a dot", "."),
			Entry("payload only", "onlypayload."),
			Entry("signature only", ".onlysig"),
		)
	})

	Describe("encodePending / decodePending", func() {
		It("round-trips a valid pending state", func() {
			p := pendingState{
				State:    "abc",
				Verifier: "xyz",
				Next:     "/foo",
				Expires:  time.Now().Add(5 * time.Minute).Unix(),
			}
			enc, err := encodePending(p, testSecret)
			Expect(err).NotTo(HaveOccurred())

			got, err := decodePending(enc, testSecret)
			Expect(err).NotTo(HaveOccurred())
			Expect(got.State).To(Equal(p.State))
			Expect(got.Verifier).To(Equal(p.Verifier))
			Expect(got.Next).To(Equal(p.Next))
		})

		It("rejects an expired pending state", func() {
			p := pendingState{
				State:   "abc",
				Expires: time.Now().Add(-time.Minute).Unix(),
			}
			enc, err := encodePending(p, testSecret)
			Expect(err).NotTo(HaveOccurred())

			_, err = decodePending(enc, testSecret)
			Expect(err).To(HaveOccurred())
		})
	})
})

func flipASCII(s string) string {
	if len(s) == 0 {
		return s
	}
	b := []byte(s)
	if b[0] == 'A' {
		b[0] = 'B'
	} else {
		b[0] = 'A'
	}
	return string(b)
}
