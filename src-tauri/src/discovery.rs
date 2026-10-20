use serde::{Deserialize, Serialize};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, UdpSocket};
use std::time::Duration;
use tokio::net::TcpStream;
use tokio::time::timeout;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredServer {
    pub ip: String,
    pub port: u16,
    pub url: String,
    pub name: Option<String>,
}

fn get_local_ipv4() -> Option<Ipv4Addr> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    match socket.local_addr().ok()?.ip() {
        IpAddr::V4(ip) if !ip.is_loopback() => Some(ip),
        _ => None,
    }
}

async fn scan_subnet(base: [u8; 3], port: u16) -> Option<DiscoveredServer> {
    let (tx, mut rx) = tokio::sync::mpsc::channel(1);

    for last in 1..=254 {
        let ip = Ipv4Addr::new(base[0], base[1], base[2], last);
        let addr = SocketAddr::new(IpAddr::V4(ip), port);
        let tx_clone = tx.clone();

        tokio::spawn(async move {
            if let Ok(Ok(_)) = timeout(Duration::from_millis(450), TcpStream::connect(addr)).await {
                let url = format!("http://{}:{}", ip, port);
                let _ = tx_clone.send(DiscoveredServer {
                    ip: ip.to_string(),
                    port,
                    url,
                    name: Some("WebStack Phone".to_string()),
                }).await;
            }
        });
    }
    drop(tx);

    rx.recv().await
}

pub async fn probe_network() -> Option<DiscoveredServer> {
    // 1. Attempt UDP broadcast discovery probe on ports 8080, 8081, 8082
    let ports = [8080u16, 8081u16, 8082u16];
    if let Ok(bind_addr) = "0.0.0.0:0".parse::<SocketAddr>() {
        if let Ok(socket) = UdpSocket::bind(bind_addr) {
            let _ = socket.set_broadcast(true);
            let _ = socket.set_read_timeout(Some(Duration::from_millis(500)));
            let ping = b"WEBSTACK_DISCOVER_PROBE";
            for &p in &ports {
                if let Ok(broadcast_addr) = format!("255.255.255.255:{}", p).parse::<SocketAddr>() {
                    let _ = socket.send_to(ping, broadcast_addr);
                }
            }

            let mut buf = [0u8; 512];
            if let Ok((len, src)) = socket.recv_from(&mut buf) {
                let msg = String::from_utf8_lossy(&buf[..len]);
                if msg.contains("WEBSTACK") {
                    let url = if let Some(pos) = msg.find("http://") {
                        msg[pos..].split_whitespace().next().unwrap_or("").to_string()
                    } else {
                        format!("http://{}:{}", src.ip(), src.port())
                    };

                    let clean_ip = url
                        .trim_start_matches("http://")
                        .split(':')
                        .next()
                        .unwrap_or(&src.ip().to_string())
                        .to_string();

                    let clean_port = url
                        .split(':')
                        .nth(2)
                        .and_then(|p| p.split('/').next())
                        .and_then(|p| p.parse::<u16>().ok())
                        .unwrap_or(src.port());

                    return Some(DiscoveredServer {
                        ip: clean_ip,
                        port: clean_port,
                        url,
                        name: Some("WebStack Phone".to_string()),
                    });
                }
            }
        }
    }

    // 2. Subnet scan fallback if UDP broadcast was blocked by router
    if let Some(local_ip) = get_local_ipv4() {
        let octets = local_ip.octets();
        for &p in &ports {
            if let Some(server) = scan_subnet([octets[0], octets[1], octets[2]], p).await {
                return Some(server);
            }
        }
    }

    None
}
