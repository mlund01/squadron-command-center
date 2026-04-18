package oauth_test

import (
	"time"

	"commander/internal/oauth"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("PendingFlows", func() {
	It("registers and claims a flow", func() {
		p := oauth.New()
		p.Register("abc", "inst-1", "linear")
		f, ok := p.Claim("abc")
		Expect(ok).To(BeTrue())
		Expect(f.InstanceID).To(Equal("inst-1"))
		Expect(f.McpName).To(Equal("linear"))
	})

	It("returns false for unknown state", func() {
		p := oauth.New()
		_, ok := p.Claim("does-not-exist")
		Expect(ok).To(BeFalse())
	})

	It("is one-shot — second claim returns false", func() {
		p := oauth.New()
		p.Register("abc", "inst-1", "linear")
		_, ok := p.Claim("abc")
		Expect(ok).To(BeTrue())
		_, ok = p.Claim("abc")
		Expect(ok).To(BeFalse())
	})

	It("evicts expired flows via Claim", func() {
		p := oauth.NewWithTTL(10 * time.Millisecond)
		p.Register("abc", "inst-1", "linear")
		time.Sleep(20 * time.Millisecond)
		_, ok := p.Claim("abc")
		Expect(ok).To(BeFalse())
	})

	It("Sweep evicts expired flows", func() {
		p := oauth.NewWithTTL(10 * time.Millisecond)
		p.Register("a", "inst-1", "x")
		p.Register("b", "inst-1", "x")
		Expect(p.Len()).To(Equal(2))
		time.Sleep(20 * time.Millisecond)
		Expect(p.Sweep()).To(Equal(2))
		Expect(p.Len()).To(Equal(0))
	})
})
