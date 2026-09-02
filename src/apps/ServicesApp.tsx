import { Lamp, State } from "../components/kit";
import { formatDuration } from "../lib/format";
import type { ServiceInfo } from "../types";

/** Why each unit matters here, written for whoever is debugging at 2am. */
const role: Record<string, string> = {
  ssh: "Carries the controller and your terminal. If it stops, this console goes blind.",
  cloudflared: "Outbound tunnel to Cloudflare. Nothing reaches the host without it.",
  docker: "Engine running every application stack.",
  containerd: "Runtime Docker delegates container execution to.",
};

export default function ServicesApp({ services }: { services: ServiceInfo[] }) {
  const active = services.filter((service) => service.active).length;

  return (
    <div className="app">
      <header className="app-head">
        <div className="app-title">
          <h1>Services</h1>
          <p>{active}/{services.length} active · read only</p>
        </div>
        <p className="note">Changing systemd needs sudo, which stays behind Ubuntu&apos;s own prompt in the terminal.</p>
      </header>

      <div className="scroller">
        <table className="grid">
          <colgroup>
            <col style={{ width: "140px" }} />
            <col style={{ width: "130px" }} />
            <col style={{ width: "120px" }} />
            <col style={{ width: "110px" }} />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Unit</th>
              <th scope="col">State</th>
              <th scope="col">Boot</th>
              <th scope="col">Active for</th>
              <th scope="col">Role</th>
            </tr>
          </thead>
          <tbody>
            {services.map((service) => (
              <tr key={service.name}>
                <td className="name">{service.name}</td>
                <td>
                  <State level={service.active ? "ok" : "fail"}>
                    {service.subState && service.subState !== service.state ? `${service.state}/${service.subState}` : service.state}
                  </State>
                </td>
                <td className="dim">{service.enabled ? "enabled" : "manual"}</td>
                <td className="dim num">{service.activeSeconds === null ? "—" : formatDuration(service.activeSeconds)}</td>
                <td className="dim" title={role[service.name]}>{role[service.name] ?? "Managed by systemd on the host."}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <footer className="log-foot">
        <span className="legend">
          <span><Lamp level="ok" /> active</span>
          <span><Lamp level="fail" /> not running</span>
        </span>
        <span className="push">every unit is loaded by systemd at boot</span>
      </footer>
    </div>
  );
}
