import ipaddr from 'ipaddr.js';

import type { ProviderAddressClassifier } from '../../product/provider-policy/provider-policy-gateway.ts';

export const publicUnicastAddressClassifier: ProviderAddressClassifier = {
  normalizePublicUnicast(address) {
    try {
      let parsed = ipaddr.parse(address);
      if (parsed instanceof ipaddr.IPv6 && parsed.isIPv4MappedAddress()) {
        parsed = parsed.toIPv4Address();
      }
      return parsed.range() === 'unicast' ? parsed.toString() : undefined;
    } catch {
      return undefined;
    }
  },
};
