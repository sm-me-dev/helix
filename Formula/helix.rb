# typed: false
# frozen_string_literal: true

# Homebrew formula for Helix
class Helix < Formula
  desc "AI coding harness with bounded context, ephemeral worktrees, and mechanical gates"
  homepage "https://github.com/sm-me-dev/helix"
  version "0.1.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.intel?
      url "https://github.com/sm-me-dev/helix/releases/download/v#{version}/helix-v#{version}-darwin-x64.tar.gz"
    elsif Hardware::CPU.arm?
      url "https://github.com/sm-me-dev/helix/releases/download/v#{version}/helix-v#{version}-darwin-arm64.tar.gz"
    end
  end

  on_linux do
    if Hardware::CPU.intel?
      url "https://github.com/sm-me-dev/helix/releases/download/v#{version}/helix-v#{version}-linux-x64.tar.gz"
    elsif Hardware::CPU.arm?
      url "https://github.com/sm-me-dev/helix/releases/download/v#{version}/helix-v#{version}-linux-arm64.tar.gz"
    end
  end

  def install
    libexec.install Dir["*"]
    bin.install_symlink libexec/"bin/helix"
  end

  test do
    assert_match "helix #{version}", shell_output("#{bin}/helix --version")
    assert_match "helix — AI coding harness", shell_output("#{bin}/helix --help")
  end
end
